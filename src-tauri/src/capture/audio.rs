//! System audio: WASAPI loopback of the default output device, encoded to
//! AAC (Media Foundation) in fragmented MP4.
//!
//! Loopback delivers nothing while nothing plays, so the gaps are filled
//! with silence from the recording clock: the track always runs from
//! recording time 0 to the stop, in step with the video. Pauses are cut
//! the same way as everywhere else (packets from a pause are dropped). If
//! the output device changes (headphones plugged in), it reopens the new
//! default device and carries on.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use windows::core::HSTRING;
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT,
    AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::Media::KernelStreaming::WAVE_FORMAT_EXTENSIBLE;
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::Media::Multimedia::{KSDATAFORMAT_SUBTYPE_IEEE_FLOAT, WAVE_FORMAT_IEEE_FLOAT};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED};

use super::clock::{qpc_now, Clock, TICKS_PER_SEC};

fn hr(e: windows::core::Error) -> String {
    format!("{} (0x{:08X})", e.message().trim(), e.code().0 as u32)
}

/// How far behind "now" silence may be added: packets can still be on
/// their way for this long.
const LATENCY: i64 = TICKS_PER_SEC * 15 / 100;
/// A late packet more than this after the written audio gets silence first.
const GAP: i64 = TICKS_PER_SEC / 50;

#[derive(Clone, Copy)]
enum SampleKind {
    F32,
    I16,
    I24,
    I32,
}

struct Loopback {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    rate: u32,
    channels: usize,
    kind: SampleKind,
    block: usize,
}

impl Loopback {
    fn open() -> Result<Loopback, String> {
        unsafe {
            let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(hr)?;
            let device = devices.GetDefaultAudioEndpoint(eRender, eConsole).map_err(|_| "No sound output device is active.")?;
            let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(hr)?;
            let fmt = client.GetMixFormat().map_err(hr)?;
            let result = (|| {
                let f: WAVEFORMATEX = std::ptr::read_unaligned(fmt);
                let tag = f.wFormatTag as u32;
                let float = if tag == WAVE_FORMAT_EXTENSIBLE {
                    let ext: WAVEFORMATEXTENSIBLE = std::ptr::read_unaligned(fmt as *const WAVEFORMATEXTENSIBLE);
                    let sub = ext.SubFormat;
                    sub == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
                } else {
                    tag == WAVE_FORMAT_IEEE_FLOAT
                };
                let bits = f.wBitsPerSample;
                let kind = match (float, bits) {
                    (true, 32) => SampleKind::F32,
                    (false, 16) => SampleKind::I16,
                    (false, 24) => SampleKind::I24,
                    (false, 32) => SampleKind::I32,
                    _ => return Err(format!("Unsupported sound format ({bits}-bit).")),
                };
                // 200 ms buffer; polled every 10 ms.
                client
                    .Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 2_000_000, 0, fmt, None)
                    .map_err(hr)?;
                let capture: IAudioCaptureClient = client.GetService().map_err(hr)?;
                client.Start().map_err(hr)?;
                Ok(Loopback {
                    client: client.clone(),
                    capture,
                    rate: f.nSamplesPerSec,
                    channels: f.nChannels.max(1) as usize,
                    kind,
                    block: f.nBlockAlign as usize,
                })
            })();
            CoTaskMemFree(Some(fmt as *const _));
            result
        }
    }

    /// Calls `each(qpc_time, stereo_f32)` for every waiting packet.
    fn read(&self, mut each: impl FnMut(i64, &[f32])) -> Result<(), windows::core::Error> {
        unsafe {
            loop {
                let n = self.capture.GetNextPacketSize()?;
                if n == 0 {
                    return Ok(());
                }
                let mut data: *mut u8 = std::ptr::null_mut();
                let mut frames = 0u32;
                let mut flags = 0u32;
                let mut qpc = 0u64;
                self.capture.GetBuffer(&mut data, &mut frames, &mut flags, None, Some(&mut qpc))?;
                let mut stereo = vec![0f32; frames as usize * 2];
                if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 == 0 && !data.is_null() {
                    let bytes = std::slice::from_raw_parts(data, frames as usize * self.block);
                    let width = self.block / self.channels;
                    let sample = |frame: usize, ch: usize| -> f32 {
                        let o = frame * self.block + ch.min(self.channels - 1) * width;
                        let b = &bytes[o..o + width];
                        match self.kind {
                            SampleKind::F32 => f32::from_le_bytes([b[0], b[1], b[2], b[3]]),
                            SampleKind::I16 => i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0,
                            SampleKind::I24 => (i32::from_le_bytes([0, b[0], b[1], b[2]]) >> 8) as f32 / 8_388_608.0,
                            SampleKind::I32 => i32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f32 / 2_147_483_648.0,
                        }
                    };
                    for i in 0..frames as usize {
                        stereo[i * 2] = sample(i, 0);
                        stereo[i * 2 + 1] = sample(i, 1);
                    }
                }
                self.capture.ReleaseBuffer(frames)?;
                each(qpc as i64, &stereo);
            }
        }
    }
}

impl Drop for Loopback {
    fn drop(&mut self) {
        unsafe {
            let _ = self.client.Stop();
        }
    }
}

/// Linear resampler for devices running at something other than 44.1 or
/// 48 kHz (the AAC encoder accepts only those). Stereo interleaved.
struct Resampler {
    step: f64,
    pos: f64,
    prev: [f32; 2],
}

impl Resampler {
    fn new(from: u32, to: u32) -> Resampler {
        Resampler { step: from as f64 / to as f64, pos: 0.0, prev: [0.0; 2] }
    }

    fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if (self.step - 1.0).abs() < f64::EPSILON {
            out.extend_from_slice(input);
            return;
        }
        let n = (input.len() / 2) as isize;
        if n == 0 {
            return;
        }
        let frame = |i: isize, c: usize| if i < 0 { self.prev[c] } else { input[i as usize * 2 + c] };
        while self.pos < (n - 1) as f64 {
            let i = self.pos.floor() as isize;
            let f = (self.pos - i as f64) as f32;
            for c in 0..2 {
                out.push(frame(i, c) * (1.0 - f) + frame(i + 1, c) * f);
            }
            self.pos += self.step;
        }
        self.pos -= n as f64;
        self.prev = [input[(n as usize - 1) * 2], input[(n as usize - 1) * 2 + 1]];
    }
}

struct AacWriter {
    writer: IMFSinkWriter,
    stream: u32,
    rate: u32,
    written: i64,
}

impl AacWriter {
    fn new(path: &Path, rate: u32) -> Result<AacWriter, String> {
        let mut last = String::new();
        for container in [MFTranscodeContainerType_FMPEG4, MFTranscodeContainerType_MPEG4] {
            match Self::create(path, rate, &container) {
                Ok(w) => return Ok(w),
                Err(e) => {
                    let _ = std::fs::remove_file(path);
                    last = e;
                }
            }
        }
        Err(last)
    }

    fn create(path: &Path, rate: u32, container: &windows::core::GUID) -> Result<AacWriter, String> {
        unsafe {
            let mut attrs = None;
            MFCreateAttributes(&mut attrs, 1).map_err(hr)?;
            let attrs = attrs.ok_or("No attribute store.")?;
            attrs.SetGUID(&MF_TRANSCODE_CONTAINERTYPE, container).map_err(hr)?;
            let writer = MFCreateSinkWriterFromURL(&HSTRING::from(path.as_os_str()), None, &attrs).map_err(hr)?;
            let out = MFCreateMediaType().map_err(hr)?;
            out.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio).map_err(hr)?;
            out.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_AAC).map_err(hr)?;
            out.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16).map_err(hr)?;
            out.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, rate).map_err(hr)?;
            out.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, 2).map_err(hr)?;
            out.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 16_000).map_err(hr)?; // 128 kbit/s
            let stream = writer.AddStream(&out).map_err(hr)?;
            let input = MFCreateMediaType().map_err(hr)?;
            input.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio).map_err(hr)?;
            input.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_PCM).map_err(hr)?;
            input.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16).map_err(hr)?;
            input.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, rate).map_err(hr)?;
            input.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, 2).map_err(hr)?;
            input.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, 4).map_err(hr)?;
            input.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, rate * 4).map_err(hr)?;
            writer.SetInputMediaType(stream, &input, None).map_err(hr)?;
            writer.BeginWriting().map_err(hr)?;
            Ok(AacWriter { writer, stream, rate, written: 0 })
        }
    }

    /// Recording time (100 ns) of the end of what's written.
    fn end_time(&self) -> i64 {
        self.written * TICKS_PER_SEC / self.rate as i64
    }

    fn frames_at(&self, t: i64) -> i64 {
        t * self.rate as i64 / TICKS_PER_SEC
    }

    fn write(&mut self, stereo: &[f32]) -> Result<(), String> {
        for chunk in stereo.chunks(self.rate as usize * 2) {
            let frames = (chunk.len() / 2) as i64;
            if frames == 0 {
                continue;
            }
            unsafe {
                let len = chunk.len() as u32 * 2;
                let buffer = MFCreateMemoryBuffer(len).map_err(hr)?;
                let mut ptr: *mut u8 = std::ptr::null_mut();
                buffer.Lock(&mut ptr, None, None).map_err(hr)?;
                let dst = std::slice::from_raw_parts_mut(ptr as *mut i16, chunk.len());
                for (d, s) in dst.iter_mut().zip(chunk) {
                    *d = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
                }
                buffer.Unlock().map_err(hr)?;
                buffer.SetCurrentLength(len).map_err(hr)?;
                let sample = MFCreateSample().map_err(hr)?;
                sample.AddBuffer(&buffer).map_err(hr)?;
                let start = self.written * TICKS_PER_SEC / self.rate as i64;
                let end = (self.written + frames) * TICKS_PER_SEC / self.rate as i64;
                sample.SetSampleTime(start).map_err(hr)?;
                sample.SetSampleDuration(end - start).map_err(hr)?;
                self.writer.WriteSample(self.stream, &sample).map_err(hr)?;
            }
            self.written += frames;
        }
        Ok(())
    }

    /// Silence up to recording time `t`.
    fn pad_to(&mut self, t: i64) -> Result<(), String> {
        let missing = self.frames_at(t) - self.written;
        if missing > 0 {
            self.write(&vec![0f32; missing as usize * 2])?;
        }
        Ok(())
    }
}

pub struct AudioCapture {
    stop: Arc<AtomicBool>,
    end: Arc<Mutex<Option<i64>>>,
    warnings: Arc<Mutex<Vec<String>>>,
    thread: Option<JoinHandle<Result<(), String>>>,
}

impl AudioCapture {
    pub fn start(path: &Path, clock: Arc<Clock>) -> Result<AudioCapture, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let end = Arc::new(Mutex::new(None));
        let warnings = Arc::new(Mutex::new(Vec::new()));
        let (ready_tx, ready_rx) = mpsc::channel();
        let thread = {
            let (path, stop, end, warnings) = (path.to_path_buf(), stop.clone(), end.clone(), warnings.clone());
            std::thread::Builder::new()
                .name("capture-audio".into())
                .spawn(move || {
                    unsafe {
                        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                    }
                    let r = run(&path, &clock, &stop, &end, &warnings, ready_tx);
                    unsafe { CoUninitialize() };
                    r
                })
                .map_err(|e| e.to_string())?
        };
        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => Ok(AudioCapture { stop, end, warnings, thread: Some(thread) }),
            Ok(Err(e)) => {
                let _ = thread.join();
                Err(e)
            }
            Err(_) => {
                stop.store(true, Ordering::Relaxed);
                Err("The sound device didn't respond.".into())
            }
        }
    }

    pub fn warnings(&self) -> Vec<String> {
        self.warnings.lock().map(|w| w.clone()).unwrap_or_default()
    }

    /// Fills up to `end` (recording time), finalizes the file.
    pub fn stop(mut self, end: i64) -> Result<Vec<String>, String> {
        *self.end.lock().unwrap() = Some(end);
        self.stop.store(true, Ordering::Relaxed);
        let r = self.thread.take().map(|t| t.join().unwrap_or_else(|_| Err("audio thread crashed".into()))).unwrap_or(Ok(()));
        r.map(|_| self.warnings())
    }
}

fn run(
    path: &Path,
    clock: &Clock,
    stop: &AtomicBool,
    end: &Mutex<Option<i64>>,
    warnings: &Mutex<Vec<String>>,
    ready: mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    let mut source = match Loopback::open() {
        Ok(s) => Some(s),
        Err(e) => {
            let _ = ready.send(Err(e.clone()));
            return Err(e);
        }
    };
    let rate = match source.as_ref().map(|s| s.rate) {
        Some(44_100) => 44_100,
        _ => 48_000,
    };
    let mut writer = match AacWriter::new(path, rate) {
        Ok(w) => w,
        Err(e) => {
            let _ = ready.send(Err(e.clone()));
            return Err(e);
        }
    };
    let _ = ready.send(Ok(()));
    let mut resampler = Resampler::new(source.as_ref().map_or(rate, |s| s.rate), rate);
    let mut retry_at = Instant::now();
    let mut failure: Option<String> = None;
    let mut converted = Vec::new();

    loop {
        let stopping = stop.load(Ordering::Relaxed);
        if source.is_none() && Instant::now() >= retry_at {
            match Loopback::open() {
                Ok(s) => {
                    resampler = Resampler::new(s.rate, rate);
                    source = Some(s);
                }
                Err(_) => retry_at = Instant::now() + Duration::from_millis(500),
            }
        }
        if let Some(src) = &source {
            let r = src.read(|qpc, stereo| {
                if failure.is_some() {
                    return;
                }
                let Some(t) = clock.rec_time(qpc) else { return };
                if t > writer.end_time() + GAP {
                    if let Err(e) = writer.pad_to(t) {
                        failure = Some(e);
                        return;
                    }
                }
                converted.clear();
                resampler.process(stereo, &mut converted);
                if let Err(e) = writer.write(&converted) {
                    failure = Some(e);
                }
            });
            if let Err(e) = r {
                log::warn!("system audio device lost: {}", hr(e));
                if let Ok(mut w) = warnings.lock() {
                    let msg = "The sound output device changed; system audio continues on the new one.".to_string();
                    if !w.contains(&msg) {
                        w.push(msg);
                    }
                }
                source = None;
                retry_at = Instant::now() + Duration::from_millis(200);
            }
        }
        if let Some(e) = failure.take() {
            return Err(e);
        }
        if stopping {
            break;
        }
        // Silence while nothing plays.
        if let Some(now) = clock.rec_time(qpc_now()) {
            if now - LATENCY > writer.end_time() {
                writer.pad_to(now - LATENCY)?;
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }

    let end = end.lock().unwrap().unwrap_or_else(|| clock.elapsed());
    writer.pad_to(end)?;
    drop(source);
    unsafe { writer.writer.Finalize() }.map_err(hr)
}

#[cfg(test)]
mod tests {
    use super::Resampler;

    #[test]
    fn resampler_keeps_length_and_passes_through_at_same_rate() {
        let input: Vec<f32> = (0..2000).map(|i| (i / 2) as f32).collect();
        let mut out = Vec::new();
        Resampler::new(48_000, 48_000).process(&input, &mut out);
        assert_eq!(out, input);

        let mut r = Resampler::new(96_000, 48_000);
        let mut out = Vec::new();
        for _ in 0..10 {
            r.process(&input, &mut out);
        }
        // 10 000 frames at 96 kHz -> ~5 000 at 48 kHz.
        assert!((out.len() as i64 / 2 - 5000).abs() <= 2, "{}", out.len() / 2);
    }
}
