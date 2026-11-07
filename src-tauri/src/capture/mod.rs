//! Native screen capture (Windows). Replaces the WebView's getDisplayMedia
//! for the screen and system-audio tracks, so there is no browser picker,
//! no "is sharing your screen" bar, no yellow border, and the mouse pointer
//! can really be left out of the video.
//!
//! - sources.rs: displays and windows to pick from, with GDI thumbnails
//!   (also the setup preview).
//! - video.rs: Windows.Graphics.Capture frames, scaled and converted to
//!   NV12 on the GPU (D3D11 video processor), H.264 through a Media
//!   Foundation sink writer into fragmented MP4 (readable after a crash).
//! - audio.rs: WASAPI loopback of the default output device, AAC into
//!   fragmented MP4, gaps filled with silence so it stays in sync.
//! - clock.rs: recording time (QPC, pauses excluded) shared by both.
//!
//! Files go into the folder of a recording begun with recording_begin
//! (screen.mp4, system-audio.m4a); the page still writes the manifest,
//! microphone, webcam and events. Other platforms report "unsupported" and
//! the page keeps using getDisplayMedia.

#[cfg(windows)]
mod audio;
#[cfg(windows)]
mod clock;
#[cfg(windows)]
mod sources;
#[cfg(windows)]
mod video;

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::ipc::Response;
use tauri::State;

use crate::recording::RecordingState;

pub const SCREEN_FILE: &str = "screen.mp4";
pub const AUDIO_FILE: &str = "system-audio.m4a";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Support {
    supported: bool,
    /// The yellow capture border can be turned off (Windows 11).
    borderless: bool,
    /// The pointer can be left out of the frames.
    cursor_control: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSource {
    pub id: String,
    /// "monitor" or "window".
    pub kind: &'static str,
    pub name: String,
    /// App (exe) name for windows.
    pub app: Option<String>,
    /// Desktop rectangle in physical pixels.
    pub bounds: crate::input::Rect,
    pub primary: bool,
    /// Same id as recorder_displays for monitors.
    pub display_id: Option<String>,
    pub minimized: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOptions {
    /// Recording session id from recording_begin.
    pub recording: String,
    pub source: String,
    pub fps: u32,
    /// None = the source's own size.
    pub max_height: Option<u32>,
    pub bitrate: u32,
    pub cursor: bool,
    pub system_audio: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    pub width: u32,
    pub height: u32,
    pub frame_rate: u32,
    pub system_audio: bool,
    /// Milliseconds between the command arriving and recording time 0, so
    /// the page can line its own clock up.
    pub setup_ms: f64,
    /// Recording time 0 on the capture clock (QPC, ms; see capture_clock).
    pub t0_ms: f64,
    pub warnings: Vec<String>,
    pub encoder: String,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub screen_bytes: u64,
    pub audio_bytes: u64,
    pub frames: u64,
    pub dropped: u64,
    /// Size of what's being captured now (a window can be resized).
    pub content_width: u32,
    pub content_height: u32,
    /// Set when capture ended on its own (window closed, display gone) or failed.
    pub ended: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stopped {
    pub screen_bytes: u64,
    pub audio_bytes: u64,
    pub duration_ms: f64,
    pub frames: u64,
    pub dropped: u64,
    pub system_audio: bool,
    pub warnings: Vec<String>,
}

#[derive(Default)]
pub struct CaptureState {
    #[cfg(windows)]
    active: Mutex<Option<video::Active>>,
    #[cfg(not(windows))]
    _unused: Mutex<()>,
}

impl CaptureState {
    /// App quitting mid-recording: finalize the files so they play.
    pub fn shutdown(&self) {
        #[cfg(windows)]
        if let Ok(mut a) = self.active.lock() {
            if let Some(active) = a.take() {
                let _ = active.stop(None);
            }
        }
    }
}

#[cfg(not(windows))]
const UNSUPPORTED: &str = "Native screen capture isn't available on this system.";

#[cfg(windows)]
fn ms_to_ticks(ms: f64) -> i64 {
    (ms * 10_000.0) as i64
}

/// The capture clock now (QPC, ms), for the page to sync its own clock to.
#[tauri::command]
pub fn capture_clock() -> f64 {
    #[cfg(windows)]
    {
        clock::qpc_now() as f64 / 10_000.0
    }
    #[cfg(not(windows))]
    0.0
}

#[tauri::command]
pub fn capture_support() -> Support {
    #[cfg(windows)]
    {
        video::support()
    }
    #[cfg(not(windows))]
    Support { supported: false, borderless: false, cursor_control: false }
}

#[tauri::command]
pub async fn capture_sources() -> Result<Vec<CaptureSource>, String> {
    #[cfg(windows)]
    {
        Ok(sources::list())
    }
    #[cfg(not(windows))]
    Err(UNSUPPORTED.into())
}

/// A still of a source, scaled to fit max_width x max_height: 8-byte
/// header (width, height as u32 LE) then RGBA pixels.
/// `fast`: cheaper, rougher scaling (live previews; the picker leaves it off).
#[tauri::command]
pub async fn capture_thumbnail(id: String, max_width: u32, max_height: u32, fast: Option<bool>) -> Result<Response, String> {
    #[cfg(windows)]
    {
        let (w, h, rgba) = sources::thumbnail(&id, max_width.clamp(16, 3840), max_height.clamp(16, 2160), fast.unwrap_or(false))?;
        Ok(Response::new(with_header(w, h, rgba)))
    }
    #[cfg(not(windows))]
    {
        let _ = (id, max_width, max_height, fast);
        Err(UNSUPPORTED.into())
    }
}

#[cfg(windows)]
fn with_header(w: u32, h: u32, rgba: Vec<u8>) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + rgba.len());
    out.extend_from_slice(&w.to_le_bytes());
    out.extend_from_slice(&h.to_le_bytes());
    out.extend_from_slice(&rgba);
    out
}

#[tauri::command]
pub async fn capture_start(
    state: State<'_, CaptureState>,
    recordings: State<'_, RecordingState>,
    options: StartOptions,
) -> Result<Started, String> {
    #[cfg(windows)]
    {
        let entered = std::time::Instant::now();
        let dir = recordings.session_dir(&options.recording).ok_or("This recording has already ended.")?;
        let mut active = state.active.lock().map_err(|_| "capture state poisoned")?;
        if active.is_some() {
            return Err("A recording is already running.".into());
        }
        let (a, mut started) = video::Active::start(&dir, &options, entered)?;
        started.setup_ms = a.t0_since(entered);
        *active = Some(a);
        log::info!("native capture started");
        Ok(started)
    }
    #[cfg(not(windows))]
    {
        let _ = (state, recordings, options);
        Err(UNSUPPORTED.into())
    }
}

#[tauri::command]
pub async fn capture_pause(state: State<'_, CaptureState>, paused: bool, at_ms: Option<f64>) -> Result<(), String> {
    #[cfg(windows)]
    {
        let active = state.active.lock().map_err(|_| "capture state poisoned")?;
        if let Some(a) = active.as_ref() {
            a.set_paused(paused, at_ms.map(ms_to_ticks));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (state, paused, at_ms);
        Err(UNSUPPORTED.into())
    }
}

#[tauri::command]
pub async fn capture_status(state: State<'_, CaptureState>) -> Result<Status, String> {
    #[cfg(windows)]
    {
        let active = state.active.lock().map_err(|_| "capture state poisoned")?;
        Ok(active.as_ref().map(|a| a.status()).unwrap_or_default())
    }
    #[cfg(not(windows))]
    {
        let _ = state;
        Err(UNSUPPORTED.into())
    }
}

#[tauri::command]
pub async fn capture_stop(state: State<'_, CaptureState>, at_ms: Option<f64>) -> Result<Stopped, String> {
    #[cfg(windows)]
    {
        let taken = state.active.lock().map_err(|_| "capture state poisoned")?.take();
        let Some(a) = taken else { return Ok(Stopped::default()) };
        let r = a.stop(at_ms.map(ms_to_ticks));
        match &r {
            Ok(s) => log::info!("native capture stopped: {:.0} ms, {} frames, {} dropped", s.duration_ms, s.frames, s.dropped),
            Err(e) => log::warn!("native capture stopped with an error: {e}"),
        }
        r
    }
    #[cfg(not(windows))]
    {
        let _ = (state, at_ms);
        Err(UNSUPPORTED.into())
    }
}

/// The latest captured frame at full size (for screenshots), same layout
/// as capture_thumbnail.
#[tauri::command]
pub async fn capture_frame(state: State<'_, CaptureState>) -> Result<Response, String> {
    #[cfg(windows)]
    {
        let active = state.active.lock().map_err(|_| "capture state poisoned")?;
        let a = active.as_ref().ok_or("Nothing is being recorded.")?;
        let (w, h, rgba) = a.frame()?;
        Ok(Response::new(with_header(w, h, rgba)))
    }
    #[cfg(not(windows))]
    {
        let _ = state;
        Err(UNSUPPORTED.into())
    }
}

/// The latest recorded frame scaled to fit (the mini player's preview).
#[tauri::command]
pub async fn capture_preview(state: State<'_, CaptureState>, max_width: u32, max_height: u32) -> Result<Response, String> {
    #[cfg(windows)]
    {
        let active = state.active.lock().map_err(|_| "capture state poisoned")?;
        let a = active.as_ref().ok_or("Nothing is being recorded.")?;
        let (w, h, rgba) = a.preview(max_width.clamp(16, 1920), max_height.clamp(16, 1080))?;
        Ok(Response::new(with_header(w, h, rgba)))
    }
    #[cfg(not(windows))]
    {
        let _ = (state, max_width, max_height);
        Err(UNSUPPORTED.into())
    }
}

/// Keeps a window out of every screen capture (it stays visible on screen).
pub fn exclude_window(window: &tauri::WebviewWindow, exclude: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        sources::exclude_from_capture(hwnd.0, exclude)
    }
    #[cfg(not(windows))]
    {
        let _ = (window, exclude);
        Ok(())
    }
}

/// Keeps the WipeClip window out of screen captures (it stays visible on
/// screen). Works for recordings, thumbnails and screenshots alike.
#[tauri::command]
pub fn capture_exclude_window(window: tauri::WebviewWindow, exclude: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        sources::exclude_from_capture(hwnd.0, exclude)
    }
    #[cfg(not(windows))]
    {
        let _ = (window, exclude);
        Ok(())
    }
}
