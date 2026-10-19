//! Screen/window video: Windows.Graphics.Capture -> D3D11 video processor
//! (scale + BGRA to NV12 on the GPU) -> Media Foundation H.264 encoder
//! (hardware when available) -> fragmented MP4 on disk.
//!
//! Frames only arrive when something on screen changes. The capture keeps
//! a copy of the newest one, and a frame clock thread encodes that copy at
//! a constant rate (frame n at n / fps of recording time, repeats
//! included), up to the stop. Constant timing matters: fragmented MP4
//! stores per-frame durations, and readers (Chromium, ffmpeg, Media
//! Foundation) disagree on uneven ones; repeated frames cost next to
//! nothing in H.264.

use std::collections::HashMap;
use std::ffi::c_void;
use std::mem::ManuallyDrop;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use windows::core::{Interface, HSTRING};
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
/// Re-send the last frame after this long without screen changes.
/// Behind by more than this (the encoder stalled): skip ahead instead of
/// catching up with a burst of identical frames.
const MAX_BEHIND: i64 = TICKS_PER_SEC;

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
        .map_err(hr)?;
    }
    let device = device.ok_or("No Direct3D device.")?;
    // Media Foundation uses the device from its own threads.
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

fn video_type(subtype: &windows::core::GUID, w: u32, h: u32, fps: u32) -> Result<IMFMediaType, String> {
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
        if high {
            out.SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_High.0 as u32).map_err(hr)?;
        }
        let stream = writer.AddStream(&out).map_err(hr)?;
        let input = video_type(&MFVideoFormat_NV12, w, h, fps)?;
        // A keyframe every 2 s keeps seeking in the editor quick.
        let params = attributes(2)?;
        params.SetUINT32(&CODECAPI_AVEncMPVGOPSize, fps * 2).map_err(hr)?;
        writer.SetInputMediaType(stream, &input, &params).map_err(hr)?;
        writer.BeginWriting().map_err(hr)?;
        Ok(Writer { writer, stream, input, hardware })
    }
}

struct Last {
    tex: ID3D11Texture2D,
    w: u32,
    h: u32,
}

struct Processor {
    en: ID3D11VideoProcessorEnumerator,
    vp: ID3D11VideoProcessor,
    input: ID3D11VideoProcessorInputView,
    w: u32,
    h: u32,
}

struct Encoder {
    device: ID3D11Device,
    ctx: ID3D11DeviceContext,
    vdev: ID3D11VideoDevice,
    vctx: ID3D11VideoContext,
    allocator: IMFVideoSampleAllocatorEx,
    writer: Option<Writer>,
    last: Option<Last>,
    proc_: Option<Processor>,
    out_views: HashMap<(usize, u32), ID3D11VideoProcessorOutputView>,
    out_w: u32,
    out_h: u32,
    fps: u32,
    interval: i64,
    /// Index of the next frame to encode (at next * interval).
    next: i64,
    frames: u64,
    dropped: u64,
    error: Option<String>,
    /// CPU-readable copy of the last frame (screenshots, mini preview).
    staging: Option<(ID3D11Texture2D, u32, u32)>,
}

// All D3D/MF objects are used under the Encoder's mutex, on a
// multithread-protected device.
unsafe impl Send for Encoder {}

impl Encoder {
    /// Keeps a copy of the newest frame (content area only): the source
    /// for encoding, repeats and screenshots.
    fn store(&mut self, tex: &ID3D11Texture2D, cw: u32, ch: u32) -> Result<(), String> {
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        unsafe { tex.GetDesc(&mut desc) };
        let (w, h) = (cw.min(desc.Width).max(2), ch.min(desc.Height).max(2));
        if self.last.as_ref().map_or(true, |l| l.w != w || l.h != h) {
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
            self.proc_ = None;
            self.out_views.clear();
        }
        let last = self.last.as_ref().unwrap();
        let bx = D3D11_BOX { left: 0, top: 0, front: 0, right: w, bottom: h, back: 1 };
        unsafe { self.ctx.CopySubresourceRegion(&last.tex, 0, 0, 0, 0, tex, 0, Some(&bx)) };
        Ok(())
    }

    fn processor(&mut self) -> Result<(), String> {
        let last = self.last.as_ref().ok_or("No frame yet.")?;
        if self.proc_.as_ref().is_some_and(|p| p.w == last.w && p.h == last.h) {
            return Ok(());
        }
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
            self.proc_ = Some(Processor { en, vp, input: input.ok_or("No input view.")?, w: last.w, h: last.h });
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

    /// Encodes the stored frame as frame `next`. false: no free buffer
    /// (the encoder is behind), try again shortly.
    fn encode_next(&mut self) -> Result<bool, String> {
        self.processor()?;
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
            w.writer.WriteSample(w.stream, &sample).map_err(|e| format!("write: {}", hr(e)))?;
        }
        self.next += 1;
        self.frames += 1;
        Ok(true)
    }

    /// Encodes every frame due by recording time `rec` (frame n is due at
    /// n * interval). Nothing before the first captured frame: the video
    /// then starts with it at time 0.
    fn pump(&mut self, rec: i64) {
        if self.error.is_some() || self.writer.is_none() || self.last.is_none() {
            return;
        }
        let due = rec / self.interval;
        if due - self.next > MAX_BEHIND / self.interval {
            self.dropped += (due - self.next) as u64;
            self.next = due;
        }
        while self.next <= due {
            match self.encode_next() {
                Ok(true) => {}
                Ok(false) => break,
                Err(e) => {
                    log::error!("screen encode failed: {e}");
                    self.error = Some(format!("The screen recording failed: {e}"));
                    return;
                }
            }
        }
    }

    /// Frames up to the stop (the last one ends at `end`), then closes the file.
    fn finish(&mut self, end: i64) -> Result<(), String> {
        if self.writer.is_none() {
            return Ok(());
        }
        if self.last.is_some() && self.error.is_none() {
            let last_due = (end - 1).max(0) / self.interval;
            // The encoder may still hold every buffer: wait, up to 1 s.
            for _ in 0..100 {
                if self.next > last_due {
                    break;
                }
                self.pump(last_due * self.interval);
                if self.next <= last_due {
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        }
        let w = self.writer.take().unwrap();
        if self.frames == 0 {
            return Err("No frames were captured.".into());
        }
        unsafe { w.writer.Finalize() }.map_err(hr)
    }

    /// The last frame as RGBA, scaled down (box filter) to fit max_w x
    /// max_h; full size when it already fits.
    fn read(&mut self, max_w: u32, max_h: u32) -> Result<(u32, u32, Vec<u8>), String> {
        let last = self.last.as_ref().ok_or("No frame from the screen yet - try again in a moment.")?;
        let (w, h) = (last.w, last.h);
        if self.staging.as_ref().map_or(true, |s| s.1 != w || s.2 != h) {
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
            self.staging = Some((t.ok_or("No texture.")?, w, h));
        }
        let staging = self.staging.as_ref().unwrap().0.clone();
        let scale = (max_w as f64 / w as f64).min(max_h as f64 / h as f64).min(1.0);
        let (tw, th) = (((w as f64 * scale).round() as u32).max(1), ((h as f64 * scale).round() as u32).max(1));
        unsafe {
            self.ctx.CopyResource(&staging, &last.tex);
            let mut map = D3D11_MAPPED_SUBRESOURCE::default();
            self.ctx.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut map)).map_err(hr)?;
            let src = std::slice::from_raw_parts(map.pData as *const u8, map.RowPitch as usize * (h as usize - 1) + w as usize * 4);
            let out = downscale(src, map.RowPitch as usize, w, h, tw, th);
            self.ctx.Unmap(&staging, 0);
            Ok((tw, th, out))
        }
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
    session: GraphicsCaptureSession,
    pool: Direct3D11CaptureFramePool,
    _item: GraphicsCaptureItem,
    ended: Arc<Mutex<Option<String>>>,
    content: Arc<Mutex<SizeInt32>>,
    stop_flag: Arc<AtomicBool>,
    keepalive: Option<JoinHandle<()>>,
    audio: Option<AudioCapture>,
    dir: PathBuf,
    t0_instant: Instant,
    warnings: Vec<String>,
}

// WinRT capture objects are agile; the D3D/MF ones live behind the mutex.
unsafe impl Send for Active {}

impl Active {
    pub fn start(dir: &Path, o: &StartOptions, _entered: Instant) -> Result<(Active, Started), String> {
        ensure_runtime()?;
        let target = parse_id(&o.source)?;
        let fps = o.fps.clamp(10, 120);
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
        let (out_w, out_h) = output_size(size.Width.max(2) as u32, size.Height.max(2) as u32, o.max_height);

        let (device, ctx) = create_device()?;
        let vdev: ID3D11VideoDevice = device.cast().map_err(|_| "This graphics driver has no video processing support.")?;
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
        for (hardware, high) in [(true, true), (true, false), (false, true), (false, false)] {
            match create_writer(&screen_path, &mgr, out_w, out_h, fps, bitrate, hardware, high) {
                Ok(w) => {
                    writer = Some(w);
                    break;
                }
                Err(e) => {
                    log::warn!("H.264 writer (hardware {hardware}, high {high}) failed: {e}");
                    last_err = e;
                    let _ = std::fs::remove_file(&screen_path);
                }
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

        let encoder = Arc::new(Mutex::new(Encoder {
            device,
            ctx,
            vdev,
            vctx,
            allocator,
            writer: Some(writer),
            last: None,
            proc_: None,
            out_views: HashMap::new(),
            out_w,
            out_h,
            fps,
            interval: TICKS_PER_SEC / fps as i64,
            next: 0,
            frames: 0,
            dropped: 0,
            error: None,
            staging: None,
        }));
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
        let _ = session.SetMinUpdateInterval(TimeSpan { Duration: TICKS_PER_SEC / fps as i64 });

        {
            let encoder = encoder.clone();
            let content = content.clone();
            let device = Agile(winrt_device.clone());
            pool.FrameArrived(&TypedEventHandler::<Direct3D11CaptureFramePool, windows::core::IInspectable>::new(move |sender, _| {
                let pool = sender.ok()?;
                let frame = pool.TryGetNextFrame()?;
                let size = frame.ContentSize()?;
                let access: IDirect3DDxgiInterfaceAccess = frame.Surface()?.cast()?;
                let tex: ID3D11Texture2D = unsafe { access.GetInterface()? };
                {
                    let mut e = encoder.lock().unwrap();
                    if let Err(err) = e.store(&tex, size.Width.max(2) as u32, size.Height.max(2) as u32) {
                        log::error!("frame copy failed: {err}");
                    }
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
        let keepalive = {
            let encoder = encoder.clone();
            let clock = clock.clone();
            let stop = stop_flag.clone();
            std::thread::Builder::new()
                .name("capture-keepalive".into())
                .spawn(move || {
                    while !stop.load(Ordering::Relaxed) {
                        std::thread::sleep(Duration::from_millis(8));
                        if let Some(rec) = clock.rec_time(qpc_now()) {
                            encoder.lock().unwrap().pump(rec);
                        }
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
                session,
                pool,
                _item: item,
                ended,
                content,
                stop_flag,
                keepalive: Some(keepalive),
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
        let e = self.encoder.lock().unwrap();
        let c = *self.content.lock().unwrap();
        let mut warnings = self.warnings.clone();
        if let Some(a) = &self.audio {
            warnings.extend(a.warnings());
        }
        Status {
            screen_bytes: self.size_of(SCREEN_FILE),
            audio_bytes: if self.audio.is_some() { self.size_of(AUDIO_FILE) } else { 0 },
            frames: e.frames,
            dropped: e.dropped,
            content_width: c.Width.max(0) as u32,
            content_height: c.Height.max(0) as u32,
            ended: self.ended.lock().unwrap().clone().or_else(|| e.error.clone()),
            warnings,
        }
    }

    pub fn frame(&self) -> Result<(u32, u32, Vec<u8>), String> {
        self.encoder.lock().unwrap().read(u32::MAX, u32::MAX)
    }

    pub fn preview(&self, max_w: u32, max_h: u32) -> Result<(u32, u32, Vec<u8>), String> {
        self.encoder.lock().unwrap().read(max_w, max_h)
    }

    pub fn stop(mut self, at: Option<i64>) -> Result<Stopped, String> {
        let now = qpc_now();
        let end = self.clock.stop(at.map_or(now, |a| a.min(now)));
        self.stop_flag.store(true, Ordering::Relaxed);
        if let Some(k) = self.keepalive.take() {
            let _ = k.join();
        }
        let _ = self.session.Close();
        let _ = self.pool.Close();
        let mut warnings = self.warnings.clone();
        {
            let e = self.encoder.lock().unwrap();
            log::info!("capture stop: end {:.0} ms ({:?} ms before now), {} frames so far", end as f64 / 10_000.0, at.map(|a| (now - a) as f64 / 10_000.0), e.frames);
        }
        let video = self.encoder.lock().unwrap().finish(end);
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
        let e = self.encoder.lock().unwrap();
        Ok(Stopped {
            screen_bytes: self.size_of(SCREEN_FILE),
            audio_bytes: if system_audio { self.size_of(AUDIO_FILE) } else { 0 },
            duration_ms: end as f64 / 10_000.0,
            frames: e.frames,
            dropped: e.dropped,
            system_audio,
            warnings,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{downscale, output_size};

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
        let (tw, th, px) = super::super::sources::thumbnail(&monitor.id, 320, 180).unwrap();
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
                while !stop.load(Ordering::Relaxed) {
                    let _ = a.preview(608, 342);
                    std::thread::sleep(Duration::from_millis(200));
                }
            })
        };
        let st = |a: &Active| { let s = a.status(); format!("frames {} dropped {} ended {:?}", s.frames, s.dropped, s.ended) };
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
