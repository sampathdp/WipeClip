//! Interaction metadata for screen recordings: where the pointer is, clicks,
//! scrolling, keyboard shortcuts and the active window, timestamped as they
//! happen so a later version of the editor can add cursor effects, auto zoom
//! and keystroke overlays without re-recording.
//!
//! Only runs while a recording runs, and only for what the user enabled in
//! the recorder (src/components/recorder). Nothing here is written to logs.
//!
//! - Pointer position is *polled* at the requested rate (30-120 Hz) and
//!   stored only when it changed, instead of taking every hardware event
//!   (gaming mice report 1000+ per second).
//! - Clicks, scrolling and keys come from OS hooks (windows.rs, macos.rs)
//!   that only push into a bounded in-memory buffer.
//! - Key presses go through keys.rs, which drops everything but shortcut
//!   combinations before they're stored. With "typing" on, other key
//!   presses only record *that* the user is typing (and where the text
//!   cursor is, when the app exposes it), at most every 120 ms - never
//!   which key.
//! - The page drains the buffer about twice a second and converts times
//!   and coordinates (src/lib/recorder/events.ts); this side only knows
//!   microseconds since the monitor started and desktop coordinates.

pub mod keys;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos as platform;
#[cfg(windows)]
mod windows;
#[cfg(windows)]
use windows as platform;
#[cfg(not(any(windows, target_os = "macos")))]
mod unsupported;
#[cfg(not(any(windows, target_os = "macos")))]
use unsupported as platform;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::State;

pub use platform::available_space;

/// Upper bound on undrained events (~25 MB). Only reached if the page
/// stops draining; further pointer samples are counted as dropped.
const MAX_BUFFERED: usize = 200_000;
const WINDOW_POLL: Duration = Duration::from_millis(250);
/// At most one typing event per this long (microseconds).
const TYPING_EVERY_US: u64 = 120_000;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "k", rename_all = "lowercase")]
pub enum RawEvent {
    Move { t: u64, x: f64, y: f64 },
    Button { t: u64, button: &'static str, down: bool, x: f64, y: f64 },
    Scroll { t: u64, dx: f64, dy: f64, x: f64, y: f64 },
    Key { t: u64, combo: String },
    /// Typing activity: no key, only the text cursor box (desktop
    /// coordinates) when the focused app exposes one.
    Typing { t: u64, caret: Option<Rect> },
    Window { t: u64, app: String, title: Option<String>, bounds: Option<Rect> },
}

#[derive(Clone, Debug, PartialEq)]
pub struct WindowInfo {
    pub id: u64,
    pub app: String,
    pub title: Option<String>,
    pub bounds: Option<Rect>,
}

// Denied/Unsupported only occur on macOS / other platforms.
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Permission {
    Granted,
    Denied,
    Unsupported,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Permissions {
    pub mouse: Permission,
    pub keyboard: Permission,
    pub active_window: Permission,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum KeyboardMode {
    Off,
    Shortcuts,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub mouse: bool,
    pub clicks: bool,
    pub scroll: bool,
    pub keyboard: KeyboardMode,
    pub active_window: bool,
    pub window_titles: bool,
    pub sample_hz: u32,
    /// Typing activity for focus zooms (see RawEvent::Typing). Missing from
    /// older pages: off.
    #[serde(default)]
    pub typing: bool,
}

#[derive(Default)]
struct Buffer {
    events: Vec<RawEvent>,
    dropped: u64,
}

/// Shared between the hook thread(s), the poll thread and the commands.
pub struct Sink {
    started: Instant,
    settings: Settings,
    buffer: Mutex<Buffer>,
    /// now_us() of the last typing event + 1 (0 = none yet).
    last_typing: AtomicU64,
}

impl Sink {
    fn new(settings: Settings) -> Self {
        Sink { started: Instant::now(), settings, buffer: Mutex::new(Buffer::default()), last_typing: AtomicU64::new(0) }
    }

    pub fn now_us(&self) -> u64 {
        self.started.elapsed().as_micros() as u64
    }

    pub fn push(&self, e: RawEvent) {
        if let Ok(mut b) = self.buffer.lock() {
            if b.events.len() >= MAX_BUFFERED {
                b.dropped += 1;
            } else {
                b.events.push(e);
            }
        }
    }

    /// Clicks and scrolling, filtered by the settings.
    pub fn push_pointer(&self, e: RawEvent) {
        let wanted = match e {
            RawEvent::Button { .. } => self.settings.clicks,
            RawEvent::Scroll { .. } => self.settings.scroll,
            _ => true,
        };
        if wanted {
            self.push(e);
        }
    }

    /// A shortcut combination (already filtered by keys.rs), if enabled.
    pub fn push_shortcut(&self, combo: String) {
        if self.settings.keyboard == KeyboardMode::Shortcuts {
            self.push(RawEvent::Key { t: self.now_us(), combo });
        }
    }

    /// Any other key press: records only that typing happened, throttled;
    /// `caret` is asked only for events that are kept.
    pub fn push_typing(&self, caret: impl FnOnce() -> Option<Rect>) {
        if !self.settings.typing {
            return;
        }
        let now = self.now_us();
        let last = self.last_typing.load(Ordering::Relaxed);
        if last != 0 && now + 1 < last + TYPING_EVERY_US {
            return;
        }
        self.last_typing.store(now + 1, Ordering::Relaxed);
        self.push(RawEvent::Typing { t: now, caret: caret() });
    }

    fn drain(&self) -> (Vec<RawEvent>, u64) {
        let b = self.buffer.lock().map(|mut g| std::mem::take(&mut *g)).unwrap_or_default();
        (b.events, b.dropped)
    }
}

/// Pointer position and active window polling, until `stop` is set.
fn poll(sink: Arc<Sink>, stop: Arc<AtomicBool>) {
    let hz = sink.settings.sample_hz.clamp(10, 240);
    let period = Duration::from_micros(1_000_000 / hz as u64);
    let mut last_pos: Option<(f64, f64)> = None;
    let mut last_window: Option<WindowInfo> = None;
    let mut next_window_check = Instant::now();
    let mut next = Instant::now();
    while !stop.load(Ordering::Relaxed) {
        if sink.settings.mouse {
            if let Some(pos) = platform::cursor_position() {
                if last_pos != Some(pos) {
                    last_pos = Some(pos);
                    sink.push(RawEvent::Move { t: sink.now_us(), x: pos.0, y: pos.1 });
                }
            }
        }
        if sink.settings.active_window && Instant::now() >= next_window_check {
            next_window_check = Instant::now() + WINDOW_POLL;
            let current = platform::foreground_window(sink.settings.window_titles);
            if current.is_some() && current != last_window {
                let w = current.clone().unwrap();
                sink.push(RawEvent::Window { t: sink.now_us(), app: w.app, title: w.title, bounds: w.bounds });
                last_window = current;
            }
        }
        // Fixed-rate schedule without drift; never sleeps less than 1 ms.
        next += period;
        let now = Instant::now();
        if next > now {
            thread::sleep(next - now);
        } else {
            next = now;
            thread::sleep(Duration::from_millis(1));
        }
    }
}

struct Monitor {
    sink: Arc<Sink>,
    stop: Arc<AtomicBool>,
    poller: Option<JoinHandle<()>>,
    hooks: Option<platform::Hooks>,
}

impl Monitor {
    fn shutdown(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(hooks) = self.hooks.take() {
            hooks.stop();
        }
        if let Some(p) = self.poller.take() {
            let _ = p.join();
        }
    }
}

#[derive(Default)]
pub struct InputState {
    monitor: Mutex<Option<Monitor>>,
}

impl InputState {
    /// Stops the monitor, e.g. when the app quits mid-recording.
    pub fn shutdown(&self) {
        if let Some(m) = self.monitor.lock().ok().and_then(|mut m| m.take()) {
            m.shutdown();
        }
    }
}

#[tauri::command]
pub fn input_permissions() -> Permissions {
    platform::permissions()
}

/// macOS: asks for Input Monitoring (system prompt, first time only).
#[tauri::command]
pub fn input_request_access() -> Permissions {
    platform::request_keyboard_access();
    platform::permissions()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartInfo {
    /// Pointer position at the start, desktop coordinates.
    pointer: Option<(f64, f64)>,
    warnings: Vec<String>,
}

#[tauri::command]
pub async fn input_start(state: State<'_, InputState>, settings: Settings) -> Result<StartInfo, String> {
    let mut slot = state.monitor.lock().map_err(|_| "input state poisoned")?;
    if let Some(old) = slot.take() {
        old.shutdown();
    }
    let sink = Arc::new(Sink::new(settings));
    let stop = Arc::new(AtomicBool::new(false));
    let keyboard = settings.keyboard == KeyboardMode::Shortcuts || settings.typing;
    let wants_hooks = settings.clicks || settings.scroll || keyboard;
    let (hooks, warnings) = if wants_hooks {
        let (h, w) = platform::start_hooks(sink.clone(), settings.clicks || settings.scroll, keyboard)?;
        (Some(h), w)
    } else {
        (None, Vec::new())
    };
    let poller = if settings.mouse || settings.active_window {
        let (s, st) = (sink.clone(), stop.clone());
        Some(thread::Builder::new().name("wipeclip-input-poll".into()).spawn(move || poll(s, st)).map_err(|e| e.to_string())?)
    } else {
        None
    };
    let pointer = platform::cursor_position();
    log::info!("input monitor started");
    *slot = Some(Monitor { sink, stop, poller, hooks });
    Ok(StartInfo { pointer, warnings })
}

/// The monitor's clock, for syncing with the page's clock.
#[tauri::command]
pub async fn input_now(state: State<'_, InputState>) -> Result<u64, String> {
    let slot = state.monitor.lock().map_err(|_| "input state poisoned")?;
    slot.as_ref().map(|m| m.sink.now_us()).ok_or_else(|| "The input monitor isn't running.".into())
}

#[derive(Serialize)]
pub struct Drained {
    events: Vec<RawEvent>,
    dropped: u64,
}

#[tauri::command]
pub async fn input_drain(state: State<'_, InputState>) -> Result<Drained, String> {
    let slot = state.monitor.lock().map_err(|_| "input state poisoned")?;
    let (events, dropped) = slot.as_ref().map(|m| m.sink.drain()).unwrap_or_default();
    Ok(Drained { events, dropped })
}

/// Stops the monitor and returns whatever was still buffered.
#[tauri::command]
pub async fn input_stop(state: State<'_, InputState>) -> Result<Drained, String> {
    let monitor = state.monitor.lock().map_err(|_| "input state poisoned")?.take();
    let Some(monitor) = monitor else { return Ok(Drained { events: Vec::new(), dropped: 0 }) };
    let sink = monitor.sink.clone();
    monitor.shutdown();
    let (events, dropped) = sink.drain();
    log::info!("input monitor stopped");
    Ok(Drained { events, dropped })
}

#[cfg(unix)]
pub(crate) fn unix_available_space(dir: &std::path::Path) -> std::io::Result<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(dir.as_os_str().as_bytes()).map_err(|_| std::io::Error::from(std::io::ErrorKind::InvalidInput))?;
    // SAFETY: NUL-terminated path, zeroed out struct.
    unsafe {
        let mut s: libc::statvfs = std::mem::zeroed();
        if libc::statvfs(c.as_ptr(), &mut s) != 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(s.f_bavail as u64 * s.f_frsize as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> Settings {
        Settings {
            mouse: true,
            clicks: false,
            scroll: true,
            keyboard: KeyboardMode::Off,
            active_window: false,
            window_titles: false,
            sample_hz: 60,
            typing: true,
        }
    }

    #[test]
    fn typing_is_throttled_and_carries_no_key() {
        let sink = Sink::new(settings());
        for _ in 0..50 {
            sink.push_typing(|| None);
        }
        let (events, _) = sink.drain();
        assert_eq!(events.len(), 1, "one event per 120 ms");
        assert!(matches!(events[0], RawEvent::Typing { caret: None, .. }));
        let off = Sink::new(Settings { typing: false, ..settings() });
        off.push_typing(|| panic!("caret not asked when typing is off"));
        off.push_shortcut("Ctrl+S".into());
        assert_eq!(off.drain().0.len(), 0, "typing off, shortcuts off");
        let json = serde_json::to_string(&RawEvent::Typing { t: 3, caret: Some(Rect { x: 1.0, y: 2.0, width: 3.0, height: 4.0 }) }).unwrap();
        assert_eq!(json, r#"{"k":"typing","t":3,"caret":{"x":1.0,"y":2.0,"width":3.0,"height":4.0}}"#);
    }

    #[test]
    fn sink_filters_and_bounds_the_buffer() {
        let sink = Sink::new(settings());
        sink.push_pointer(RawEvent::Button { t: 1, button: "left", down: true, x: 0.0, y: 0.0 });
        sink.push_pointer(RawEvent::Scroll { t: 2, dx: 0.0, dy: 1.0, x: 0.0, y: 0.0 });
        let (events, dropped) = sink.drain();
        assert_eq!(events.len(), 1, "clicks disabled");
        assert_eq!(dropped, 0);
        for i in 0..MAX_BUFFERED + 5 {
            sink.push(RawEvent::Move { t: i as u64, x: 0.0, y: 0.0 });
        }
        let (events, dropped) = sink.drain();
        assert_eq!(events.len(), MAX_BUFFERED);
        assert_eq!(dropped, 5);
        assert_eq!(sink.drain().0.len(), 0, "drain empties the buffer");
    }

    #[test]
    fn events_serialize_compactly_tagged() {
        let json = serde_json::to_string(&RawEvent::Button { t: 5, button: "right", down: false, x: 1.0, y: 2.0 }).unwrap();
        assert_eq!(json, r#"{"k":"button","t":5,"button":"right","down":false,"x":1.0,"y":2.0}"#);
        let s: Settings = serde_json::from_str(
            r#"{"mouse":true,"clicks":true,"scroll":true,"keyboard":"shortcuts","activeWindow":false,"windowTitles":false,"sampleHz":60}"#,
        )
        .unwrap();
        assert_eq!(s.keyboard, KeyboardMode::Shortcuts);
        assert!(!s.typing, "older pages don't send typing: off");
    }
}
