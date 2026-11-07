//! Screen/window video: Windows.Graphics.Capture -> D3D11 video processor
//! (scale + BGRA to NV12 on the GPU) -> Media Foundation H.264 encoder
//! (hardware when available) -> fragmented MP4 on disk.
//!
//! Frames only arrive when something on screen changes. The capture keeps
//! a copy of the newest one, and an encoder thread encodes that copy at a
//! constant rate (frame n at n / fps of recording time, repeats included),
//! up to the stop. Constant timing matters: fragmented MP4 stores
//! per-frame durations, and readers (Chromium, ffmpeg, Media Foundation)
//! disagree on uneven ones; repeated frames cost next to nothing in H.264.
//!
//! Three parts that never wait on each other (what keeps slow machines
//! from freezing):
//! - the capture callback only copies the new frame on the GPU, under the
//!   short `Latest` lock;
//! - the encoder thread converts and writes. Media Foundation's
//!   WriteSample blocks while the encoder is behind; only this thread waits;
//! - previews read the frame back through two staging textures, so a
//!   preview never waits for the GPU (and never stalls the other two).
//!
//! The D3D device is multithread protected, so its immediate context can
//! be used from all three threads (each call is serialized by D3D itself).
//!
//! Without a hardware encoder (no driver, or a GPU without one) the
//! software encoder is set up for speed: at most 720p and 30 fps, Baseline
//! profile, no B-frames, fastest preset. That is what a dual-core laptop
//! can encode in real time next to everything else.

use std::collections::HashMap;
use std::ffi::c_void;
use std::mem::ManuallyDrop;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use windows::core::{Interface, GUID, HSTRING};
use windows::Foundation::Metadata::ApiInformation;
use windows::Foundation::{TimeSpan, TypedEventHandler};
use windows::Graphics::Capture::{
    Direct3D11CaptureFramePool, GraphicsCaptureAccess, GraphicsCaptureAccessKind, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::SizeInt32;
use windows::Win32::Foundation::{HMODULE, RECT};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL_10_0, D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_11_1};
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_RATIONAL, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::CoIncrementMTAUsage;
use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::UI::WindowsAndMessaging::IsIconic;

use super::audio::AudioCapture;
use super::clock::{qpc_now, Clock, TICKS_PER_SEC};
use super::sources::{parse_id, Target};
use super::{Started, StartOptions, Status, Stopped, Support, AUDIO_FILE, SCREEN_FILE};

const CAPTURE_CLASS: &str = "Windows.Graphics.Capture.GraphicsCaptureSession";
/// Largest frame common hardware H.264 encoders (and Microsoft's software
/// one) accept; bigger displays are scaled down to fit.
const MAX_W: u32 = 4096;
const MAX_H: u32 = 2304;
/// Software encoder limits: what a dual-core CPU encodes in real time.
const SOFTWARE_MAX_H: u32 = 720;
const SOFTWARE_MAX_FPS: u32 = 30;
const SOFTWARE_MIN_BITRATE: u32 = 1_500_000;
/// Behind by more than this (the encoder stalled): skip ahead instead of
/// catching up with a burst of identical frames.
const MAX_BEHIND: i64 = TICKS_PER_SEC;

/// Width, height, RGBA pixels.
type Rgba = (u32, u32, Vec<u8>);

fn hr(e: windows::core::Error) -> String {
    format!("{} (0x{:08X})", e.message().trim(), e.code().0 as u32)
}

pub fn ensure_runtime() -> Result<(), String> {
    static INIT: OnceLock<Result<(), String>> = OnceLock::new();
    INIT.get_or_init(|| unsafe {
        // Keeps the multithreaded apartment alive so the command threads
        // (no COM init of their own) can use WinRT and Media Foundation.
        let _ = CoIncrementMTAUsage();
        MFStartup(MF_VERSION, MFSTARTUP_FULL).map_err(hr)
    })
    .clone()
}

pub fn support() -> Support {
    let present = |p: &str| ApiInformation::IsPropertyPresent(&HSTRING::from(CAPTURE_CLASS), &HSTRING::from(p)).unwrap_or(false);
    let supported = ensure_runtime().is_ok() && GraphicsCaptureSession::IsSupported().unwrap_or(false);
    Support { supported, borderless: supported && present("IsBorderRequired"), cursor_control: supported && present("IsCursorCaptureEnabled") }
}

fn create_device() -> Result<(ID3D11Device, ID3D11DeviceContext), String> {
    let mut device = None;
    let mut ctx = None;
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
            Some(&[D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_10_0]),
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut ctx),
        )
        .map_err(|e| format!("This computer's graphics driver can't be used for recording ({}). Installing the latest graphics driver usually fixes this.", hr(e)))?;
    }
    let device = device.ok_or("No Direct3D device.")?;
    // The capture callback, the encoder thread, previews and Media
    // Foundation all use the device and its immediate context.
    if let Ok(mt) = device.cast::<ID3D11Multithread>() {
        unsafe {
            let _ = mt.SetMultithreadProtected(true);
        }
    }
    Ok((device, ctx.ok_or("No Direct3D context.")?))
}

fn pack(hi: u32, lo: u32) -> u64 {
    ((hi as u64) << 32) | lo as u64
}

fn attributes(n: u32) -> Result<IMFAttributes, String> {
    let mut a = None;
    unsafe { MFCreateAttributes(&mut a, n) }.map_err(hr)?;
    a.ok_or_else(|| "No attribute store.".to_string())
}

fn video_type(subtype: &GUID, w: u32, h: u32, fps: u32) -> Result<IMFMediaType, String> {
    unsafe {
        let t = MFCreateMediaType().map_err(hr)?;
        t.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video).map_err(hr)?;
        t.SetGUID(&MF_MT_SUBTYPE, subtype).map_err(hr)?;
        t.SetUINT64(&MF_MT_FRAME_SIZE, pack(w, h)).map_err(hr)?;
        t.SetUINT64(&MF_MT_FRAME_RATE, pack(fps, 1)).map_err(hr)?;
        t.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack(1, 1)).map_err(hr)?;
        t.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32).map_err(hr)?;
        t.SetUINT32(&MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709.0 as u32).map_err(hr)?;
        t.SetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235.0 as u32).map_err(hr)?;
        t.SetUINT32(&MF_MT_VIDEO_PRIMARIES, MFVideoPrimaries_BT709.0 as u32).map_err(hr)?;
        t.SetUINT32(&MF_MT_TRANSFER_FUNCTION, MFVideoTransFunc_709.0 as u32).map_err(hr)?;
        Ok(t)
    }
}

struct Writer {
    writer: IMFSinkWriter,
    stream: u32,
    input: IMFMediaType,
    hardware: bool,
}

/// The encoder the sink writer really loaded: asking for hardware
/// transforms still gives the software one when there is no hardware
/// encoder. None when it can't be told.
fn loaded_encoder_is_hardware(writer: &IMFSinkWriter, stream: u32) -> Option<bool> {
    let ex: IMFSinkWriterEx = writer.cast().ok()?;
    for i in 0..8 {
        let mut category = GUID::zeroed();
        let mut transform: Option<IMFTransform> = None;
        if unsafe { ex.GetTransformForStream(stream, i, Some(&mut category), &mut transform) }.is_err() {
            return None;
        }
        if category == MFT_CATEGORY_VIDEO_ENCODER {
            let attrs = unsafe { transform?.GetAttributes() }.ok()?;
            return Some(unsafe { attrs.GetStringLength(&MFT_ENUM_HARDWARE_URL_Attribute) }.is_ok());
        }
    }
    None
}

#[allow(clippy::too_many_arguments)]
fn create_writer(path: &Path, mgr: &IMFDXGIDeviceManager, w: u32, h: u32, fps: u32, bitrate: u32, hardware: bool, high: bool) -> Result<Writer, String> {
    unsafe {
        let attrs = attributes(4)?;
        attrs.SetGUID(&MF_TRANSCODE_CONTAINERTYPE, &MFTranscodeContainerType_FMPEG4).map_err(hr)?;
        attrs.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, hardware as u32).map_err(hr)?;
        if hardware {
            attrs.SetUnknown(&MF_SINK_WRITER_D3D_MANAGER, mgr).map_err(hr)?;
        }
        let writer = MFCreateSinkWriterFromURL(&HSTRING::from(path.as_os_str()), None, &attrs).map_err(hr)?;
        let out = video_type(&MFVideoFormat_H264, w, h, fps)?;
        out.SetUINT32(&MF_MT_AVG_BITRATE, bitrate).map_err(hr)?;
        // Not set: Baseline, the encoder's default (and its fastest).
        if high {
            out.SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_High.0 as u32).map_err(hr)?;
        }
        let stream = writer.AddStream(&out).map_err(hr)?;
        let input = video_type(&MFVideoFormat_NV12, w, h, fps)?;
        // Encoder settings (ICodecAPI properties, passed on by the writer).
        let params = attributes(4)?;
        // A keyframe every 2 s keeps seeking in the editor quick.
        params.SetUINT32(&CODECAPI_AVEncMPVGOPSize, fps * 2).map_err(hr)?;
        if !hardware {
            // The CPU encoder: fastest preset, and no B-frames (they cost
            // it the most for the least on screen content).
            params.SetUINT32(&CODECAPI_AVEncCommonQualityVsSpeed, 0).map_err(hr)?;
            params.SetUINT32(&CODECAPI_AVEncMPVDefaultBPictureCount, 0).map_err(hr)?;
        }
        writer.SetInputMediaType(stream, &input, &params).map_err(hr)?;
        writer.BeginWriting().map_err(hr)?;
        let hardware = hardware && loaded_encoder_is_hardware(&writer, stream).unwrap_or(true);
        Ok(Writer { writer, stream, input, hardware })
    }
}

/// Output size, frame rate and bitrate for the software encoder, from what
/// was asked for (never more than that).
fn software_settings(sw: u32, sh: u32, max_height: Option<u32>, fps: u32, bitrate: u32) -> (u32, u32, u32, u32) {
    let (w, h) = output_size(sw, sh, Some(max_height.map_or(SOFTWARE_MAX_H, |m| m.min(SOFTWARE_MAX_H))));
    let (fw, fh) = output_size(sw, sh, max_height);
    let soft_fps = fps.min(SOFTWARE_MAX_FPS);
    // Same bits per pixel as asked for, within limits.
    let share = (w as f64 * h as f64 * soft_fps as f64) / (fw as f64 * fh as f64 * fps as f64).max(1.0);
    let rate = ((bitrate as f64 * share) as u32).max(SOFTWARE_MIN_BITRATE).min(bitrate.max(SOFTWARE_MIN_BITRATE));
    (w, h, soft_fps, rate)
}

#[derive(Clone)]
struct Last {
    tex: ID3D11Texture2D,
    w: u32,
    h: u32,
}

impl Last {
    fn key(&self) -> usize {
        self.tex.as_raw() as usize
    }
}

/// The newest captured frame (content area only): the source for
/// encoding, repeats, screenshots and previews. Locked only for a GPU copy.
struct Latest {
    device: ID3D11Device,
    ctx: ID3D11DeviceContext,
    last: Option<Last>,
}

// Used under its mutex, on a multithread-protected device.
unsafe impl Send for Latest {}

impl Latest {
    fn store(&mut self, tex: &ID3D11Texture2D, cw: u32, ch: u32) -> Result<(), String> {
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        unsafe { tex.GetDesc(&mut desc) };
        let (w, h) = (cw.min(desc.Width).max(2), ch.min(desc.Height).max(2));
        if self.last.as_ref().map_or(true, |l| l.w != w || l.h != h) {
            // A new texture: the encoder sees the change by its pointer and
            // rebuilds its video processor (the old one keeps the old
            // texture alive until then).
            let d = D3D11_TEXTURE2D_DESC {
                Width: w,
                Height: h,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
                CPUAccessFlags: 0,
                MiscFlags: 0,
            };
            let mut t = None;
            unsafe { self.device.CreateTexture2D(&d, None, Some(&mut t)) }.map_err(hr)?;
            self.last = Some(Last { tex: t.ok_or("No texture.")?, w, h });
        }
        let last = self.last.as_ref().unwrap();
        let bx = D3D11_BOX { left: 0, top: 0, front: 0, right: w, bottom: h, back: 1 };
        unsafe { self.ctx.CopySubresourceRegion(&last.tex, 0, 0, 0, 0, tex, 0, Some(&bx)) };
        Ok(())
    }
}

fn snapshot(latest: &Mutex<Latest>) -> Option<Last> {
    latest.lock().unwrap().last.clone()
}

/// Counters the page polls; never behind the encoder's lock.
#[derive(Default)]
struct Stats {
    frames: AtomicU64,
    dropped: AtomicU64,
    error: Mutex<Option<String>>,
}

struct Processor {
    en: ID3D11VideoProcessorEnumerator,
    vp: ID3D11VideoProcessor,
    input: ID3D11VideoProcessorInputView,
    /// The frame texture the input view is on.
    src: usize,
}

struct Encoder {
    vdev: ID3D11VideoDevice,
    vctx: ID3D11VideoContext,
    allocator: IMFVideoSampleAllocatorEx,
    writer: Option<Writer>,
    proc_: Option<Processor>,
    out_views: HashMap<(usize, u32), ID3D11VideoProcessorOutputView>,
    out_w: u32,
    out_h: u32,
    fps: u32,
    interval: i64,
    /// Index of the next frame to encode (at next * interval).
    next: i64,
    failed: bool,
    stats: Arc<Stats>,
}

// All D3D/MF objects are used under the Encoder's mutex, on a
// multithread-protected device.
unsafe impl Send for Encoder {}

impl Encoder {
    fn processor(&mut self, last: &Last) -> Result<(), String> {
        if self.proc_.as_ref().is_some_and(|p| p.src == last.key()) {
            return Ok(());
        }
        self.proc_ = None;
        self.out_views.clear();
        let rate = DXGI_RATIONAL { Numerator: self.fps, Denominator: 1 };
        let desc = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
            InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            InputFrameRate: rate,
            InputWidth: last.w,
            InputHeight: last.h,
            OutputFrameRate: rate,
            OutputWidth: self.out_w,
            OutputHeight: self.out_h,
            Usage: D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
        };
        unsafe {
            let en = self.vdev.CreateVideoProcessorEnumerator(&desc).map_err(hr)?;
            let vp = self.vdev.CreateVideoProcessor(&en, 0).map_err(hr)?;
            let ivd = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
                FourCC: 0,
                ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
                Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPIV { MipSlice: 0, ArraySlice: 0 } },
            };
            let mut input = None;
            self.vdev.CreateVideoProcessorInputView(&last.tex, &en, &ivd, Some(&mut input)).map_err(|e| format!("input view: {}", hr(e)))?;
            // Full-range RGB in, BT.709 limited-range YUV out (what the
            // output media type declares).
            self.vctx.VideoProcessorSetStreamColorSpace(&vp, 0, &D3D11_VIDEO_PROCESSOR_COLOR_SPACE { _bitfield: 0 });
            self.vctx.VideoProcessorSetOutputColorSpace(&vp, &D3D11_VIDEO_PROCESSOR_COLOR_SPACE { _bitfield: 4 | 16 });
            self.vctx.VideoProcessorSetStreamFrameFormat(&vp, 0, D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE);
            self.vctx.VideoProcessorSetStreamAutoProcessingMode(&vp, 0, false);
            // Letterbox when a window's shape changed since the start.
            let s = (self.out_w as f64 / last.w as f64).min(self.out_h as f64 / last.h as f64);
            let (dw, dh) = ((last.w as f64 * s).round() as i32, (last.h as f64 * s).round() as i32);
            let (dx, dy) = ((self.out_w as i32 - dw) / 2, (self.out_h as i32 - dh) / 2);
            let src = RECT { left: 0, top: 0, right: last.w as i32, bottom: last.h as i32 };
            let dst = RECT { left: dx, top: dy, right: dx + dw, bottom: dy + dh };
            let full = RECT { left: 0, top: 0, right: self.out_w as i32, bottom: self.out_h as i32 };
            self.vctx.VideoProcessorSetStreamSourceRect(&vp, 0, true, Some(&src));
            self.vctx.VideoProcessorSetStreamDestRect(&vp, 0, true, Some(&dst));
            self.vctx.VideoProcessorSetOutputTargetRect(&vp, true, Some(&full));
            let black = D3D11_VIDEO_COLOR { Anonymous: D3D11_VIDEO_COLOR_0 { RGBA: D3D11_VIDEO_COLOR_RGBA { R: 0.0, G: 0.0, B: 0.0, A: 1.0 } } };
            self.vctx.VideoProcessorSetOutputBackgroundColor(&vp, false, &black);
            self.proc_ = Some(Processor { en, vp, input: input.ok_or("No input view.")?, src: last.key() });
        }
        Ok(())
    }

    fn output_view(&mut self, tex: &ID3D11Texture2D, sub: u32) -> Result<ID3D11VideoProcessorOutputView, String> {
        let key = (tex.as_raw() as usize, sub);
        if let Some(v) = self.out_views.get(&key) {
            return Ok(v.clone());
        }
        let p = self.proc_.as_ref().ok_or("No video processor.")?;
        let desc = if sub == 0 {
            D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
                ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
                Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 } },
            }
        } else {
            D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
                ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2DARRAY,
                Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
                    Texture2DArray: D3D11_TEX2D_ARRAY_VPOV { MipSlice: 0, FirstArraySlice: sub, ArraySize: 1 },
                },
            }
        };
        let mut view = None;
        unsafe { self.vdev.CreateVideoProcessorOutputView(tex, &p.en, &desc, Some(&mut view)) }.map_err(|e| format!("output view (sub {sub}): {}", hr(e)))?;
        let view = view.ok_or("No output view.")?;
        self.out_views.insert(key, view.clone());
        Ok(view)
    }

    /// Encodes `last` as frame `next`. false: no free buffer (the encoder
    /// is behind), try again shortly.
    fn encode_next(&mut self, last: &Last) -> Result<bool, String> {
        self.processor(last)?;
        let Ok(sample) = (unsafe { self.allocator.AllocateSample() }) else { return Ok(false) };
        unsafe {
            let buffer = sample.GetBufferByIndex(0).map_err(hr)?;
            // Allocator buffers come back empty; the encoder rejects those.
            buffer.SetCurrentLength(buffer.GetMaxLength().map_err(hr)?).map_err(hr)?;
            let dxgi: IMFDXGIBuffer = buffer.cast().map_err(hr)?;
            let mut raw: *mut c_void = std::ptr::null_mut();
            dxgi.GetResource(&ID3D11Texture2D::IID, &mut raw).map_err(hr)?;
            let tex = ID3D11Texture2D::from_raw(raw);
            let sub = dxgi.GetSubresourceIndex().map_err(hr)?;
            let view = self.output_view(&tex, sub)?;
            let p = self.proc_.as_ref().unwrap();
            let mut streams = [D3D11_VIDEO_PROCESSOR_STREAM {
                Enable: true.into(),
                pInputSurface: ManuallyDrop::new(Some(p.input.clone())),
                ..Default::default()
            }];
            let r = self.vctx.VideoProcessorBlt(&p.vp, &view, 0, &streams);
            ManuallyDrop::drop(&mut streams[0].pInputSurface);
            r.map_err(|e| format!("blt: {}", hr(e)))?;
            sample.SetSampleTime(self.next * self.interval).map_err(hr)?;
            sample.SetSampleDuration(self.interval).map_err(hr)?;
            let w = self.writer.as_ref().ok_or("The screen recording has already ended.")?;
            // May block while the encoder catches up; only this thread waits.
            w.writer.WriteSample(w.stream, &sample).map_err(|e| format!("write: {}", hr(e)))?;
        }
        self.next += 1;
        self.stats.frames.fetch_add(1, Ordering::Relaxed);
        Ok(true)
    }

    /// Encodes every frame due by recording time `rec` (frame n is due at
    /// n * interval). Nothing before the first captured frame: the video
    /// then starts with it at time 0. Returns when the next frame is due
    /// (recording time), None before the first frame.
    fn pump(&mut self, rec: i64, latest: &Mutex<Latest>) -> Option<i64> {
        if self.failed || self.writer.is_none() {
            return None;
        }
        let last = snapshot(latest)?;
        let due = rec / self.interval;
        if due - self.next > MAX_BEHIND / self.interval {
            self.stats.dropped.fetch_add((due - self.next) as u64, Ordering::Relaxed);
            self.next = due;
        }
        while self.next <= due {
            match self.encode_next(&last) {
                Ok(true) => {}
                Ok(false) => break,
                Err(e) => {
                    log::error!("screen encode failed: {e}");
                    self.failed = true;
                    *self.stats.error.lock().unwrap() = Some(format!("The screen recording failed: {e}"));
                    return None;
                }
            }
        }
        Some(self.next * self.interval)
    }

    /// Frames up to the stop (the last one ends at `end`), then closes the file.
    fn finish(&mut self, end: i64, latest: &Mutex<Latest>) -> Result<(), String> {
        if self.writer.is_none() {
            return Ok(());
        }
        if snapshot(latest).is_some() && !self.failed {
            let last_due = (end - 1).max(0) / self.interval;
            // The encoder may still hold every buffer: wait, up to 1 s.
            for _ in 0..100 {
                if self.next > last_due {
                    break;
                }
                self.pump(last_due * self.interval, latest);
                if self.next <= last_due {
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        }
        let w = self.writer.take().unwrap();
        if self.stats.frames.load(Ordering::Relaxed) == 0 {
            return Err("No frames were captured.".into());
        }
        unsafe { w.writer.Finalize() }.map_err(hr)
    }
}

/// Reads the newest frame back to the CPU for previews and screenshots.
/// Two staging textures take turns: each preview copies the current frame
/// into one and maps the other (copied by the previous preview, so the GPU
/// is done with it). A preview is therefore one preview old, and never
/// waits for the GPU or holds up capture and encoding.
struct Reader {
    device: ID3D11Device,
    ctx: ID3D11DeviceContext,
    staging: [Option<Last>; 2],
    filled: [bool; 2],
    turn: usize,
}

unsafe impl Send for Reader {}

impl Reader {
    fn ensure(&mut self, i: usize, w: u32, h: u32) -> Result<ID3D11Texture2D, String> {
        if let Some(s) = self.staging[i].as_ref().filter(|s| s.w == w && s.h == h) {
            return Ok(s.tex.clone());
        }
        let d = D3D11_TEXTURE2D_DESC {
            Width: w,
            Height: h,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
        };
        let mut t = None;
        unsafe { self.device.CreateTexture2D(&d, None, Some(&mut t)) }.map_err(hr)?;
        let tex = t.ok_or("No texture.")?;
        self.staging[i] = Some(Last { tex: tex.clone(), w, h });
        self.filled[i] = false;
        Ok(tex)
    }

    /// Maps `tex`, then scales it down (box filter) to fit max_w x max_h.
    /// `wait`: false gives up when the GPU isn't done with it yet.
    fn map_scaled(&self, tex: &ID3D11Texture2D, w: u32, h: u32, max_w: u32, max_h: u32, wait: bool) -> Option<Result<Rgba, String>> {
        let scale = (max_w as f64 / w as f64).min(max_h as f64 / h as f64).min(1.0);
        let (tw, th) = (((w as f64 * scale).round() as u32).max(1), ((h as f64 * scale).round() as u32).max(1));
        let flags = if wait { 0 } else { D3D11_MAP_FLAG_DO_NOT_WAIT.0 as u32 };
        unsafe {
            let mut map = D3D11_MAPPED_SUBRESOURCE::default();
            if let Err(e) = self.ctx.Map(tex, 0, D3D11_MAP_READ, flags, Some(&mut map)) {
                return if wait { Some(Err(hr(e))) } else { None };
            }
            let src = std::slice::from_raw_parts(map.pData as *const u8, map.RowPitch as usize * (h as usize - 1) + w as usize * 4);
            let out = downscale(src, map.RowPitch as usize, w, h, tw, th);
            self.ctx.Unmap(tex, 0);
            Some(Ok((tw, th, out)))
        }
    }

    /// `fresh`: this very frame (screenshots); else possibly the one before.
    fn read(&mut self, last: &Last, max_w: u32, max_h: u32, fresh: bool) -> Result<Rgba, String> {
        let (w, h) = (last.w, last.h);
        let i = self.turn;
        self.turn ^= 1;
        let tex = self.ensure(i, w, h)?;
        unsafe { self.ctx.CopyResource(&tex, &last.tex) };
        self.filled[i] = true;
        let j = i ^ 1;
        if !fresh && self.filled[j] {
            if let Some(prev) = self.staging[j].as_ref().filter(|s| s.w == w && s.h == h) {
                if let Some(r) = self.map_scaled(&prev.tex, w, h, max_w, max_h, false) {
                    return r;
                }
            }
        }
        self.map_scaled(&tex, w, h, max_w, max_h, true).unwrap()
    }
}

/// BGRA rows (with pitch) to RGBA at tw x th, averaging each source block.
fn downscale(src: &[u8], pitch: usize, w: u32, h: u32, tw: u32, th: u32) -> Vec<u8> {
    let mut out = vec![0u8; (tw * th * 4) as usize];
    for ty in 0..th {
        let (y0, y1) = ((ty * h / th) as usize, (((ty + 1) * h / th).max(ty * h / th + 1)).min(h) as usize);
        for tx in 0..tw {
            let (x0, x1) = ((tx * w / tw) as usize, (((tx + 1) * w / tw).max(tx * w / tw + 1)).min(w) as usize);
            // At most 4x4 samples per block keeps big downscales cheap.
            let (sy, sx) = (((y1 - y0) / 4).max(1), ((x1 - x0) / 4).max(1));
            let mut acc = [0u32; 3];
            let mut n = 0u32;
            for y in (y0..y1).step_by(sy) {
                for x in (x0..x1).step_by(sx) {
                    let o = y * pitch + x * 4;
                    acc[0] += src[o + 2] as u32;
                    acc[1] += src[o + 1] as u32;
                    acc[2] += src[o] as u32;
                    n += 1;
                }
            }
            let d = ((ty * tw + tx) * 4) as usize;
            out[d] = (acc[0] / n) as u8;
            out[d + 1] = (acc[1] / n) as u8;
            out[d + 2] = (acc[2] / n) as u8;
            out[d + 3] = 255;
        }
    }
    out
}

fn output_size(sw: u32, sh: u32, max_height: Option<u32>) -> (u32, u32) {
    let h = max_height.map_or(sh, |m| m.min(sh)).max(2) as f64;
    let mut w = sw as f64 * h / sh.max(1) as f64;
    let mut h = h;
    let s = (MAX_W as f64 / w).min(MAX_H as f64 / h).min(1.0);
    w *= s;
    h *= s;
    let even = |v: f64| ((v.round() as u32) & !1).max(2);
    (even(w), even(h))
}

/// Sleeps with sub-millisecond precision (a high-resolution waitable
/// timer, Windows 10 1803+), so the encoder wakes when a frame is due
/// instead of polling. Plain sleep where that timer isn't available.
struct Ticker(Option<windows_sys::Win32::Foundation::HANDLE>);

#[link(name = "kernel32")]
extern "system" {
    fn CreateWaitableTimerExW(attributes: *const c_void, name: *const u16, flags: u32, access: u32) -> *mut c_void;
}

impl Ticker {
    fn new() -> Ticker {
        use windows_sys::Win32::System::Threading::{CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS};
        let h = unsafe { CreateWaitableTimerExW(std::ptr::null(), std::ptr::null(), CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS) };
        Ticker((!h.is_null()).then_some(h))
    }

    /// `ticks`: 100 ns units.
    fn sleep(&self, ticks: i64) {
        use windows_sys::Win32::System::Threading::{SetWaitableTimer, WaitForSingleObject};
        if let Some(h) = self.0 {
            let due = -ticks.max(1); // negative: relative
            unsafe {
                if SetWaitableTimer(h, &due, 0, None, std::ptr::null(), 0) != 0 {
                    WaitForSingleObject(h, 1000);
                    return;
                }
            }
        }
        std::thread::sleep(Duration::from_nanos(ticks.max(1) as u64 * 100));
    }
}

impl Drop for Ticker {
    fn drop(&mut self) {
        if let Some(h) = self.0 {
            unsafe { windows_sys::Win32::Foundation::CloseHandle(h) };
        }
    }
}

/// The WinRT Direct3D device is free-threaded (the frame pool calls back
/// on any thread), but its binding isn't marked Send.
struct Agile<T>(T);
unsafe impl<T> Send for Agile<T> {}
unsafe impl<T> Sync for Agile<T> {}
impl<T> Agile<T> {
    // A method, so closures capture the wrapper and not the field.
    fn get(&self) -> &T {
        &self.0
    }
}

pub struct Active {
    clock: Arc<Clock>,
    encoder: Arc<Mutex<Encoder>>,
    latest: Arc<Mutex<Latest>>,
    reader: Mutex<Reader>,
    stats: Arc<Stats>,
    session: GraphicsCaptureSession,
    pool: Direct3D11CaptureFramePool,
    _item: GraphicsCaptureItem,
    ended: Arc<Mutex<Option<String>>>,
    content: Arc<Mutex<SizeInt32>>,
    stop_flag: Arc<AtomicBool>,
    pumper: Option<JoinHandle<()>>,
    audio: Option<AudioCapture>,
    dir: PathBuf,
    t0_instant: Instant,
    warnings: Vec<String>,
}

// WinRT capture objects are agile; the D3D/MF ones live behind mutexes.
unsafe impl Send for Active {}

impl Active {
    pub fn start(dir: &Path, o: &StartOptions, _entered: Instant) -> Result<(Active, Started), String> {
        ensure_runtime()?;
        let target = parse_id(&o.source)?;
        let mut fps = o.fps.clamp(10, 120);
        let mut warnings = Vec::new();
        let item: GraphicsCaptureItem = unsafe {
            let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>().map_err(hr)?;
            match target {
                Target::Monitor(m) => interop.CreateForMonitor(m).map_err(|_| "That display isn't available any more. Choose it again.")?,
                Target::Window(w) => {
                    if IsIconic(w).as_bool() {
                        return Err("That window is minimized. Restore it, then start the recording.".into());
                    }
                    interop.CreateForWindow(w).map_err(|_| "That window can't be recorded (it was closed, or it's protected).")?
                }
            }
        };
        let size = item.Size().map_err(hr)?;
        let (sw, sh) = (size.Width.max(2) as u32, size.Height.max(2) as u32);
        let (mut out_w, mut out_h) = output_size(sw, sh, o.max_height);

        let (device, ctx) = create_device()?;
        let vdev: ID3D11VideoDevice = device.cast().map_err(|_| "This graphics driver has no video processing support. Installing the latest graphics driver usually fixes this.")?;
        let vctx: ID3D11VideoContext = ctx.cast().map_err(hr)?;
        let mut token = 0u32;
        let mut mgr = None;
        unsafe { MFCreateDXGIDeviceManager(&mut token, &mut mgr) }.map_err(hr)?;
        let mgr = mgr.ok_or("No device manager.")?;
        unsafe { mgr.ResetDevice(&device, token) }.map_err(hr)?;

        let screen_path = dir.join(SCREEN_FILE);
        let bitrate = o.bitrate.clamp(500_000, 80_000_000);
        let mut writer = None;
        let mut last_err = String::new();
        // Hardware first. Asking for it can still load the software
        // encoder (no hardware one): that one gets its own, lighter settings.
        // WIPECLIP_FORCE_SOFTWARE_ENCODER=1 skips the hardware one (support,
        // and testing what laptops without one get).
        let force_software = std::env::var_os("WIPECLIP_FORCE_SOFTWARE_ENCODER").is_some_and(|v| v == "1");
        for high in if force_software { vec![] } else { vec![true, false] } {
            match create_writer(&screen_path, &mgr, out_w, out_h, fps, bitrate, true, high) {
                Ok(w) if w.hardware => {
                    writer = Some(w);
                    break;
                }
                Ok(w) => {
                    log::warn!("no hardware H.264 encoder (the software one was loaded)");
                    drop(w);
                    let _ = std::fs::remove_file(&screen_path);
                    break;
                }
                Err(e) => {
                    log::warn!("H.264 writer (hardware, high {high}) failed: {e}");
                    last_err = e;
                    let _ = std::fs::remove_file(&screen_path);
                }
            }
        }
        if writer.is_none() {
            let (w, h, f, b) = software_settings(sw, sh, o.max_height, fps, bitrate);
            for high in [false, true] {
                match create_writer(&screen_path, &mgr, w, h, f, b, false, high) {
                    Ok(wr) => {
                        writer = Some(wr);
                        break;
                    }
                    Err(e) => {
                        log::warn!("H.264 writer (software, high {high}) failed: {e}");
                        last_err = e;
                        let _ = std::fs::remove_file(&screen_path);
                    }
                }
            }
            if writer.is_some() {
                if (w, h, f) != (out_w, out_h, fps) {
                    warnings.push(format!(
                        "This computer has no hardware video encoder available, so the screen is recorded at {h}p and {f} fps to keep up. Installing the latest graphics driver may enable the hardware encoder."
                    ));
                }
                log::info!("software H.264: {w}x{h} @ {f} fps, {b} bps (asked {out_w}x{out_h} @ {fps}, {bitrate})");
                (out_w, out_h, fps) = (w, h, f);
            }
        }
        let writer = writer.ok_or_else(|| format!("No H.264 encoder could be started: {last_err}"))?;
        let encoder_name = if writer.hardware { "hardware" } else { "software" }.to_string();

        let allocator: IMFVideoSampleAllocatorEx = unsafe {
            let mut raw: *mut c_void = std::ptr::null_mut();
            MFCreateVideoSampleAllocatorEx(&IMFVideoSampleAllocatorEx::IID, &mut raw).map_err(hr)?;
            IMFVideoSampleAllocatorEx::from_raw(raw)
        };
        unsafe {
            allocator.SetDirectXManager(&mgr).map_err(hr)?;
            let a = attributes(2)?;
            a.SetUINT32(&MF_SA_D3D11_BINDFLAGS, D3D11_BIND_RENDER_TARGET.0 as u32).map_err(hr)?;
            allocator.InitializeSampleAllocatorEx(4, 12, &a, &writer.input).map_err(hr)?;
        }

        let winrt_device: IDirect3DDevice = unsafe {
            let dxgi: IDXGIDevice = device.cast().map_err(hr)?;
            CreateDirect3D11DeviceFromDXGIDevice(&dxgi).map_err(hr)?.cast().map_err(hr)?
        };

        let stats = Arc::new(Stats::default());
        let encoder = Arc::new(Mutex::new(Encoder {
            vdev,
            vctx,
            allocator,
            writer: Some(writer),
            proc_: None,
            out_views: HashMap::new(),
            out_w,
            out_h,
            fps,
            interval: TICKS_PER_SEC / fps as i64,
            next: 0,
            failed: false,
            stats: stats.clone(),
        }));
        let latest = Arc::new(Mutex::new(Latest { device: device.clone(), ctx: ctx.clone(), last: None }));
        let reader = Mutex::new(Reader { device, ctx, staging: [None, None], filled: [false, false], turn: 0 });
        let clock = Arc::new(Clock::default());
        let ended = Arc::new(Mutex::new(None::<String>));
        let content = Arc::new(Mutex::new(size));

        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&winrt_device, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size).map_err(hr)?;
        let session = pool.CreateCaptureSession(&item).map_err(hr)?;
        if session.SetIsCursorCaptureEnabled(o.cursor).is_err() && !o.cursor {
            warnings.push("This version of Windows can't leave the pointer out; it's in the video.".into());
        }
        // Windows 11 grants this to desktop apps without asking; bounded
        // anyway so a prompt can never hold up the start.
        if let Ok(op) = GraphicsCaptureAccess::RequestAccessAsync(GraphicsCaptureAccessKind::Borderless) {
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let _ = tx.send(op.join());
            });
            let _ = rx.recv_timeout(Duration::from_secs(2));
        }
        let _ = session.SetIsBorderRequired(false);
        // No more frames than get encoded: each one costs a GPU copy.
        let _ = session.SetMinUpdateInterval(TimeSpan { Duration: TICKS_PER_SEC / fps as i64 });

        {
            let latest = latest.clone();
            let content = content.clone();
            let device = Agile(winrt_device.clone());
            pool.FrameArrived(&TypedEventHandler::<Direct3D11CaptureFramePool, windows::core::IInspectable>::new(move |sender, _| {
                let pool = sender.ok()?;
                let frame = pool.TryGetNextFrame()?;
                let size = frame.ContentSize()?;
                let access: IDirect3DDxgiInterfaceAccess = frame.Surface()?.cast()?;
                let tex: ID3D11Texture2D = unsafe { access.GetInterface()? };
                if let Err(err) = latest.lock().unwrap().store(&tex, size.Width.max(2) as u32, size.Height.max(2) as u32) {
                    log::error!("frame copy failed: {err}");
                }
                drop(tex);
                let _ = frame.Close();
                let mut c = content.lock().unwrap();
                if size.Width != c.Width || size.Height != c.Height {
                    *c = size;
                    pool.Recreate(device.get(), DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, size)?;
                }
                Ok(())
            }))
            .map_err(hr)?;
        }
        {
            let ended = ended.clone();
            let window = matches!(target, Target::Window(_));
            item.Closed(&TypedEventHandler::<GraphicsCaptureItem, windows::core::IInspectable>::new(move |_, _| {
                *ended.lock().unwrap() = Some(if window {
                    "The recorded window was closed.".into()
                } else {
                    "The recorded display was disconnected.".into()
                });
                Ok(())
            }))
            .map_err(hr)?;
        }

        let audio = if o.system_audio {
            match AudioCapture::start(&dir.join(AUDIO_FILE), clock.clone()) {
                Ok(a) => Some(a),
                Err(e) => {
                    log::warn!("system audio unavailable: {e}");
                    let _ = std::fs::remove_file(dir.join(AUDIO_FILE));
                    warnings.push(format!("System audio can't be recorded: {e}"));
                    None
                }
            }
        } else {
            None
        };

        session.StartCapture().map_err(hr)?;
        let t0_instant = Instant::now();
        let t0 = qpc_now();
        clock.start(t0);

        let stop_flag = Arc::new(AtomicBool::new(false));
        let pumper = {
            let encoder = encoder.clone();
            let latest = latest.clone();
            let clock = clock.clone();
            let stop = stop_flag.clone();
            let interval = TICKS_PER_SEC / fps as i64;
            std::thread::Builder::new()
                .name("capture-encoder".into())
                .spawn(move || {
                    let ticker = Ticker::new();
                    // Before the first frame and while paused: check every 5 ms.
                    let idle = TICKS_PER_SEC / 200;
                    while !stop.load(Ordering::Relaxed) {
                        let wait = match clock.rec_time(qpc_now()) {
                            Some(rec) => match encoder.lock().unwrap().pump(rec, &latest) {
                                // Wake when the next frame is due (rec time
                                // runs at real speed while recording).
                                Some(next_at) => clock.rec_time(qpc_now()).map_or(idle, |now| next_at - now),
                                None => idle,
                            },
                            None => idle,
                        };
                        ticker.sleep(wait.clamp(TICKS_PER_SEC / 1000, interval.max(idle)));
                    }
                })
                .map_err(|e| e.to_string())?
        };

        let started = Started {
            width: out_w,
            height: out_h,
            frame_rate: fps,
            system_audio: audio.is_some(),
            setup_ms: 0.0,
            t0_ms: t0 as f64 / 10_000.0,
            warnings: warnings.clone(),
            encoder: encoder_name,
        };
        Ok((
            Active {
                clock,
                encoder,
                latest,
                reader,
                stats,
                session,
                pool,
                _item: item,
                ended,
                content,
                stop_flag,
                pumper: Some(pumper),
                audio,
                dir: dir.to_path_buf(),
                t0_instant,
                warnings,
            },
            started,
        ))
    }

    pub fn t0_since(&self, entered: Instant) -> f64 {
        self.t0_instant.saturating_duration_since(entered).as_secs_f64() * 1000.0
    }

    /// `at`: when the page paused, in QPC ticks (its clock is synced to
    /// ours), so IPC delays don't shift the cut; never later than now.
    pub fn set_paused(&self, paused: bool, at: Option<i64>) {
        let now = qpc_now();
        self.clock.set_paused(paused, at.map_or(now, |a| a.min(now)));
        log::info!("capture {} at {:?} ms before now, rec now {:.0} ms", if paused { "paused" } else { "resumed" }, at.map(|a| (now - a) as f64 / 10_000.0), self.clock.elapsed() as f64 / 10_000.0);
    }

    fn size_of(&self, name: &str) -> u64 {
        std::fs::metadata(self.dir.join(name)).map(|m| m.len()).unwrap_or(0)
    }

    pub fn status(&self) -> Status {
        let c = *self.content.lock().unwrap();
        let mut warnings = self.warnings.clone();
        if let Some(a) = &self.audio {
            warnings.extend(a.warnings());
        }
        Status {
            screen_bytes: self.size_of(SCREEN_FILE),
            audio_bytes: if self.audio.is_some() { self.size_of(AUDIO_FILE) } else { 0 },
            frames: self.stats.frames.load(Ordering::Relaxed),
            dropped: self.stats.dropped.load(Ordering::Relaxed),
            content_width: c.Width.max(0) as u32,
            content_height: c.Height.max(0) as u32,
            ended: self.ended.lock().unwrap().clone().or_else(|| self.stats.error.lock().unwrap().clone()),
            warnings,
        }
    }

    fn read(&self, max_w: u32, max_h: u32, fresh: bool) -> Result<Rgba, String> {
        let last = snapshot(&self.latest).ok_or("No frame from the screen yet - try again in a moment.")?;
        self.reader.lock().unwrap().read(&last, max_w, max_h, fresh)
    }

    pub fn frame(&self) -> Result<Rgba, String> {
        self.read(u32::MAX, u32::MAX, true)
    }

    pub fn preview(&self, max_w: u32, max_h: u32) -> Result<Rgba, String> {
        self.read(max_w, max_h, false)
    }

    pub fn stop(mut self, at: Option<i64>) -> Result<Stopped, String> {
        let now = qpc_now();
        let end = self.clock.stop(at.map_or(now, |a| a.min(now)));
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(k) = self.pumper.take() {
            let _ = k.join();
        }
        let _ = self.session.Close();
        let _ = self.pool.Close();
        let mut warnings = self.warnings.clone();
        log::info!(
            "capture stop: end {:.0} ms ({:?} ms before now), {} frames so far",
            end as f64 / 10_000.0,
            at.map(|a| (now - a) as f64 / 10_000.0),
            self.stats.frames.load(Ordering::Relaxed)
        );
        let video = self.encoder.lock().unwrap().finish(end, &self.latest);
        let mut system_audio = false;
        if let Some(a) = self.audio.take() {
            match a.stop(end) {
                Ok(w) => {
                    system_audio = true;
                    warnings.extend(w);
                }
                Err(e) => warnings.push(format!("System audio couldn't be saved: {e}")),
            }
        }
        video?;
        Ok(Stopped {
            screen_bytes: self.size_of(SCREEN_FILE),
            audio_bytes: if system_audio { self.size_of(AUDIO_FILE) } else { 0 },
            duration_ms: end as f64 / 10_000.0,
            frames: self.stats.frames.load(Ordering::Relaxed),
            dropped: self.stats.dropped.load(Ordering::Relaxed),
            system_audio,
            warnings,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{downscale, output_size, software_settings};

    #[test]
    fn downscale_averages_blocks_and_swaps_channels() {
        // 4x2 BGRA, pitch 20 (padded): left half blue, right half red.
        let mut src = vec![0u8; 20 * 2];
        for y in 0..2 {
            for x in 0..4 {
                let o = y * 20 + x * 4;
                if x < 2 {
                    src[o] = 200;
                } else {
                    src[o + 2] = 100;
                }
            }
        }
        let out = downscale(&src, 20, 4, 2, 2, 1);
        assert_eq!(out, vec![0, 0, 200, 255, 100, 0, 0, 255]);
        assert_eq!(downscale(&src, 20, 4, 2, 4, 2).len(), 32);
    }

    #[test]
    fn output_sizes_are_even_and_fit_the_encoder() {
        assert_eq!(output_size(1920, 1080, None), (1920, 1080));
        assert_eq!(output_size(1920, 1080, Some(720)), (1280, 720));
        assert_eq!(output_size(1921, 1081, None), (1920, 1080));
        let (w, h) = output_size(5120, 1440, None);
        assert!(w <= 4096 && h <= 2304 && w % 2 == 0 && h % 2 == 0);
        assert_eq!(output_size(3840, 2160, Some(4000)), (3840, 2160));
    }

    #[test]
    fn software_encoder_gets_720p30_at_most() {
        // 1080p60 at 10 Mbps asked: 720p30, bitrate scaled by pixels x fps.
        let (w, h, f, b) = software_settings(1920, 1080, None, 60, 10_000_000);
        assert_eq!((w, h, f), (1280, 720, 30));
        assert!((2_000_000..=2_300_000).contains(&b), "{b}");
        // Already small: unchanged.
        assert_eq!(software_settings(1366, 768, Some(720), 30, 2_000_000), (1280, 720, 30, 2_000_000));
        // Never below the floor, never above what was asked.
        assert_eq!(software_settings(1920, 1080, None, 30, 1_000_000).3, 1_500_000);
        assert_eq!(software_settings(1280, 720, None, 30, 4_000_000).3, 4_000_000);
    }
}

/// Real capture on this machine (needs a desktop session):
/// `cargo test --lib capture::video::live -- --ignored --nocapture`
#[cfg(test)]
mod live {
    use super::*;
    use windows::Win32::System::Variant::VT_UI8;

    pub fn duration_s(path: &Path) -> f64 {
        unsafe {
            let reader = MFCreateSourceReaderFromURL(&HSTRING::from(path.as_os_str()), None).unwrap();
            let v = reader.GetPresentationAttribute(MF_SOURCE_READER_MEDIASOURCE.0 as u32, &MF_PD_DURATION).unwrap();
            assert_eq!(v.Anonymous.Anonymous.vt, VT_UI8);
            v.Anonymous.Anonymous.Anonymous.uhVal as f64 / 1e7
        }
    }

    #[test]
    #[ignore]
    fn records_primary_display_with_pause() {
        let dir = std::env::temp_dir().join(format!("wipeclip-capture-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let sources = super::super::sources::list();
        let monitor = sources.iter().find(|s| s.kind == "monitor").unwrap();
        println!("{} sources, first window: {:?}", sources.len(), sources.iter().find(|s| s.kind == "window").map(|s| (&s.name, &s.app)));
        let (tw, th, px) = super::super::sources::thumbnail(&monitor.id, 320, 180, false).unwrap();
        assert_eq!(px.len(), (tw * th * 4) as usize);
        let o = StartOptions {
            recording: String::new(),
            source: monitor.id.clone(),
            fps: 30,
            max_height: Some(720),
            bitrate: 4_000_000,
            cursor: false,
            system_audio: true,
        };
        let (a, started) = Active::start(&dir, &o, Instant::now()).unwrap();
        println!("started {}x{} audio {} encoder {} warnings {:?}", started.width, started.height, started.system_audio, started.encoder, started.warnings);
        std::thread::sleep(Duration::from_millis(1500));
        a.set_paused(true, None);
        std::thread::sleep(Duration::from_millis(1000));
        a.set_paused(false, None);
        std::thread::sleep(Duration::from_millis(1500));
        let (fw, fh, _) = a.frame().unwrap();
        println!("frame {fw}x{fh}, status {:?} {:?}", a.status().screen_bytes, a.status().ended);
        let stopped = a.stop(None).unwrap();
        println!("stopped: {} ms, {} frames, {} dropped, {} / {} bytes, {:?}", stopped.duration_ms, stopped.frames, stopped.dropped, stopped.screen_bytes, stopped.audio_bytes, stopped.warnings);
        let v = duration_s(&dir.join(SCREEN_FILE));
        println!("video duration {v:.3}s");
        assert!((v - stopped.duration_ms / 1000.0).abs() < 0.1, "video {v} vs clock {}", stopped.duration_ms);
        assert!((stopped.duration_ms - 3000.0).abs() < 800.0, "sleeps took {} ms", stopped.duration_ms);
        if stopped.system_audio {
            let s = duration_s(&dir.join(AUDIO_FILE));
            println!("audio duration {s:.3}s");
            assert!((s - stopped.duration_ms / 1000.0).abs() < 0.1, "audio {s}");
        }
        println!("kept in {}", dir.display());
    }

    /// The software encoder path on a machine that has a hardware one:
    /// what a laptop without one gets.
    #[test]
    #[ignore]
    fn software_encoder_keeps_up() {
        let dir = std::env::temp_dir().join(format!("wipeclip-capture-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        ensure_runtime().unwrap();
        let m = super::super::sources::list().into_iter().find(|s| s.kind == "monitor").unwrap();
        let (sw, sh) = (m.bounds.width as u32, m.bounds.height as u32);
        let (w, h, f, b) = software_settings(sw, sh, None, 30, 6_000_000);
        let (device, _) = create_device().unwrap();
        let mut token = 0u32;
        let mut mgr = None;
        unsafe { MFCreateDXGIDeviceManager(&mut token, &mut mgr) }.unwrap();
        let mgr = mgr.unwrap();
        unsafe { mgr.ResetDevice(&device, token) }.unwrap();
        let wr = create_writer(&dir.join("soft.mp4"), &mgr, w, h, f, b, false, false).unwrap();
        println!("software writer {w}x{h} @ {f} ({b} bps), hardware {}", wr.hardware);
        assert!(!wr.hardware);
        drop(wr);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

#[cfg(test)]
mod live_window {
    use super::*;

    #[test]
    #[ignore]
    fn records_a_window() {
        let dir = std::env::temp_dir().join(format!("wipeclip-capture-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let w = super::super::sources::list().into_iter().find(|s| s.kind == "window" && !s.minimized).expect("an open window");
        println!("window: {} ({:?}) {:?}", w.name, w.app, (w.bounds.width, w.bounds.height));
        let o = StartOptions { recording: String::new(), source: w.id.clone(), fps: 60, max_height: None, bitrate: 6_000_000, cursor: true, system_audio: false };
        let (a, started) = Active::start(&dir, &o, Instant::now()).unwrap();
        std::thread::sleep(Duration::from_millis(2000));
        let stopped = a.stop(None).unwrap();
        println!("{}x{} {} frames, {} ms", started.width, started.height, stopped.frames, stopped.duration_ms);
        assert!(stopped.frames >= 2 && stopped.screen_bytes > 0);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

#[cfg(test)]
mod live_preview {
    use super::*;

    #[test]
    #[ignore]
    fn pause_with_preview_reads() {
        let dir = std::env::temp_dir().join(format!("wipeclip-capture-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let m = super::super::sources::list().into_iter().find(|s| s.kind == "monitor").unwrap();
        let o = StartOptions { recording: String::new(), source: m.id, fps: 30, max_height: None, bitrate: 6_000_000, cursor: true, system_audio: false };
        let (a, _) = Active::start(&dir, &o, Instant::now()).unwrap();
        let a = Arc::new(a);
        let stop = Arc::new(AtomicBool::new(false));
        let reader = {
            let (a, stop) = (a.clone(), stop.clone());
            std::thread::spawn(move || {
                let mut slowest = Duration::ZERO;
                while !stop.load(Ordering::Relaxed) {
                    let t = Instant::now();
                    let _ = a.preview(608, 342);
                    slowest = slowest.max(t.elapsed());
                    std::thread::sleep(Duration::from_millis(200));
                }
                println!("slowest preview read: {slowest:?}");
            })
        };
        let st = |a: &Active| {
            let s = a.status();
            format!("frames {} dropped {} ended {:?}", s.frames, s.dropped, s.ended)
        };
        std::thread::sleep(Duration::from_millis(2000));
        println!("before pause: {}", st(&a));
        a.set_paused(true, Some(qpc_now() - 900_000)); // as the page does: its exact time, ~90 ms ago
        std::thread::sleep(Duration::from_millis(1200));
        a.set_paused(false, None);
        println!("after resume: {}", st(&a));
        std::thread::sleep(Duration::from_millis(1500));
        println!("before stop: {}", st(&a));
        stop.store(true, Ordering::Relaxed);
        reader.join().unwrap();
        let a = Arc::try_unwrap(a).ok().unwrap();
        let s = a.stop(None).unwrap();
        println!("stopped {} ms, {} frames, {} dropped", s.duration_ms, s.frames, s.dropped);
        let v = live::duration_s(&dir.join(SCREEN_FILE));
        println!("video {v}");
        std::fs::remove_dir_all(&dir).unwrap();
        assert!((v - s.duration_ms / 1000.0).abs() < 0.1);
    }
}

#[cfg(test)]
#[path = "video_sync_test.rs"]
mod live_sync;
