//! macOS input monitor: listen-only CGEventTaps on a dedicated run-loop
//! thread, cursor location from a fresh CGEvent, and the frontmost window
//! from CGWindowListCopyWindowInfo.
//!
//! Permissions (System Settings > Privacy & Security):
//! - Pointer position needs nothing.
//! - Clicks and scrolling: a listen-only tap for mouse events works
//!   without a prompt on current macOS; if the system refuses the tap the
//!   recorder reports clicks as unavailable instead of failing.
//! - Keyboard shortcuts need "Input Monitoring". CGPreflightListenEventAccess
//!   checks it without prompting; CGRequestListenEventAccess shows the
//!   system prompt once (afterwards the user must enable it in Settings and
//!   restart the app). Secure text fields (passwords) never deliver keys to
//!   taps at all.
//! - Window owner names and bounds need nothing; window *titles* of other
//!   apps need "Screen Recording", which a screen recording already has.
//!
//! Coordinates are points in the global display space (origin at the top
//! left of the main display), matching display bounds divided by their
//! scale factor - see recorder_displays in super.

use std::ffi::c_void;
use std::sync::{mpsc, Arc};
use std::thread::{self, JoinHandle};

use core_foundation::base::TCFType;
use core_foundation::dictionary::{CFDictionary, CFDictionaryGetValue, CFDictionaryRef};
use core_foundation::number::{kCFNumberSInt64Type, CFNumberGetValue, CFNumberRef};
use core_foundation::array::{CFArrayGetCount, CFArrayGetValueAtIndex};
use core_foundation::runloop::CFRunLoop;
use core_foundation::string::{CFString, CFStringRef};
use core_graphics::event::{
    CGEvent, CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
    CallbackResult, EventField,
};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use core_graphics::geometry::CGRect;
use core_graphics::window::{
    copy_window_info, kCGNullWindowID, kCGWindowBounds, kCGWindowLayer, kCGWindowListExcludeDesktopElements,
    kCGWindowListOptionOnScreenOnly, kCGWindowName, kCGWindowNumber, kCGWindowOwnerName,
};

use super::keys::{self, Modifiers, Platform};
use super::{Permission, Permissions, RawEvent, Rect, Sink, WindowInfo};

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightListenEventAccess() -> bool;
    fn CGRequestListenEventAccess() -> bool;
}

pub fn permissions() -> Permissions {
    // SAFETY: plain status query, available since macOS 10.15.
    let keyboard = unsafe { CGPreflightListenEventAccess() };
    Permissions {
        mouse: Permission::Granted,
        keyboard: if keyboard { Permission::Granted } else { Permission::Denied },
        active_window: Permission::Granted,
    }
}

pub fn request_keyboard_access() {
    // SAFETY: shows the system prompt (first time only) and returns.
    unsafe { CGRequestListenEventAccess() };
}

pub fn cursor_position() -> Option<(f64, f64)> {
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState).ok()?;
    let event = CGEvent::new(source).ok()?;
    let p = event.location();
    Some((p.x, p.y))
}

fn on_mouse(sink: &Sink, etype: CGEventType, event: &CGEvent) {
    let p = event.location();
    let (x, y) = (p.x, p.y);
    let t = sink.now_us();
    let button = |button: &'static str, down: bool| RawEvent::Button { t, button, down, x, y };
    let e = match etype {
        CGEventType::LeftMouseDown => button("left", true),
        CGEventType::LeftMouseUp => button("left", false),
        CGEventType::RightMouseDown => button("right", true),
        CGEventType::RightMouseUp => button("right", false),
        CGEventType::OtherMouseDown | CGEventType::OtherMouseUp => {
            let down = matches!(etype, CGEventType::OtherMouseDown);
            // Button 2 is the middle button; higher numbers are side buttons.
            let n = event.get_integer_value_field(EventField::MOUSE_EVENT_BUTTON_NUMBER);
            button(if n == 2 { "middle" } else { "other" }, down)
        }
        CGEventType::ScrollWheel => {
            // Line-based deltas, positive = up/left in the OS's convention
            // (already reflecting the user's natural-scrolling setting);
            // recorded dy is positive for scrolling down, like Windows.
            let dy = event.get_integer_value_field(EventField::SCROLL_WHEEL_EVENT_DELTA_AXIS_1) as f64;
            let dx = event.get_integer_value_field(EventField::SCROLL_WHEEL_EVENT_DELTA_AXIS_2) as f64;
            if dx == 0.0 && dy == 0.0 {
                return;
            }
            RawEvent::Scroll { t, dx: -dx, dy: -dy, x, y }
        }
        _ => return,
    };
    sink.push_pointer(e);
}

fn on_key(sink: &Sink, etype: CGEventType, event: &CGEvent) {
    if !matches!(etype, CGEventType::KeyDown) {
        return;
    }
    if event.get_integer_value_field(EventField::KEYBOARD_EVENT_AUTOREPEAT) != 0 {
        return;
    }
    let code = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE) as u16;
    let flags = event.get_flags();
    let m = Modifiers {
        ctrl: flags.contains(CGEventFlags::CGEventFlagControl),
        alt: flags.contains(CGEventFlags::CGEventFlagAlternate),
        shift: flags.contains(CGEventFlags::CGEventFlagShift),
        meta: flags.contains(CGEventFlags::CGEventFlagCommand),
    };
    if let Some(label) = keys::mac_key(code).and_then(|k| keys::shortcut_label(k, m, Platform::MacOs)) {
        sink.push_shortcut(label);
    } else {
        // Modifiers alone arrive as FlagsChanged, not KeyDown. No text
        // cursor position on macOS (that needs the Accessibility API).
        sink.push_typing(|| None);
    }
}

pub struct Hooks {
    run_loop: CFRunLoop,
    join: Option<JoinHandle<()>>,
}

pub fn start_hooks(sink: Arc<Sink>, mouse: bool, keyboard: bool) -> Result<(Hooks, Vec<String>), String> {
    let keyboard = keyboard && matches!(permissions().keyboard, Permission::Granted);
    let (tx, rx) = mpsc::channel::<(CFRunLoop, bool, bool)>();
    let join = thread::Builder::new()
        .name("wipeclip-input-taps".into())
        .spawn(move || {
            let run_loop = CFRunLoop::get_current();
            let mouse_sink = sink.clone();
            let mouse_tap = if mouse {
                CGEventTap::new(
                    CGEventTapLocation::Session,
                    CGEventTapPlacement::TailAppendEventTap,
                    CGEventTapOptions::ListenOnly,
                    vec![
                        CGEventType::LeftMouseDown,
                        CGEventType::LeftMouseUp,
                        CGEventType::RightMouseDown,
                        CGEventType::RightMouseUp,
                        CGEventType::OtherMouseDown,
                        CGEventType::OtherMouseUp,
                        CGEventType::ScrollWheel,
                    ],
                    move |_proxy, etype, event| {
                        on_mouse(&mouse_sink, etype, event);
                        CallbackResult::Keep
                    },
                )
                .ok()
            } else {
                None
            };
            let key_sink = sink.clone();
            let key_tap = if keyboard {
                CGEventTap::new(
                    CGEventTapLocation::Session,
                    CGEventTapPlacement::TailAppendEventTap,
                    CGEventTapOptions::ListenOnly,
                    vec![CGEventType::KeyDown],
                    move |_proxy, etype, event| {
                        on_key(&key_sink, etype, event);
                        CallbackResult::Keep
                    },
                )
                .ok()
            } else {
                None
            };
            for tap in mouse_tap.iter().chain(key_tap.iter()) {
                if let Ok(source) = tap.mach_port().create_runloop_source(0) {
                    // SAFETY: kCFRunLoopCommonModes is a valid static CFString.
                    run_loop.add_source(&source, unsafe { core_foundation::runloop::kCFRunLoopCommonModes });
                    tap.enable();
                }
            }
            let _ = tx.send((run_loop, mouse && mouse_tap.is_none(), keyboard && key_tap.is_none()));
            if mouse_tap.is_some() || key_tap.is_some() {
                CFRunLoop::run_current();
            }
            drop(mouse_tap);
            drop(key_tap);
        })
        .map_err(|e| format!("couldn't start the input monitor: {e}"))?;
    let (run_loop, mouse_failed, keyboard_failed) =
        rx.recv().map_err(|_| "the input monitor stopped unexpectedly".to_string())?;
    let mut warnings = Vec::new();
    if mouse_failed {
        warnings.push("macOS didn't allow monitoring clicks and scrolling.".to_string());
    }
    if keyboard_failed {
        warnings.push("macOS didn't allow monitoring keyboard shortcuts.".to_string());
    }
    Ok((Hooks { run_loop, join: Some(join) }, warnings))
}

impl Hooks {
    pub fn stop(mut self) {
        self.run_loop.stop();
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

unsafe fn dict_i64(dict: CFDictionaryRef, key: CFStringRef) -> Option<i64> {
    let v = CFDictionaryGetValue(dict, key as *const c_void);
    if v.is_null() {
        return None;
    }
    let mut out = 0i64;
    CFNumberGetValue(v as CFNumberRef, kCFNumberSInt64Type, &mut out as *mut i64 as *mut c_void).then_some(out)
}

unsafe fn dict_string(dict: CFDictionaryRef, key: CFStringRef) -> Option<String> {
    let v = CFDictionaryGetValue(dict, key as *const c_void);
    (!v.is_null()).then(|| CFString::wrap_under_get_rule(v as CFStringRef).to_string())
}

pub fn foreground_window(with_title: bool) -> Option<WindowInfo> {
    let list = copy_window_info(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID)?;
    // SAFETY: the list holds CFDictionaries (CGWindowListCopyWindowInfo's
    // documented shape); every key is a static CFString from CoreGraphics.
    unsafe {
        let array = list.as_concrete_TypeRef();
        for i in 0..CFArrayGetCount(array) {
            let dict = CFArrayGetValueAtIndex(array, i) as CFDictionaryRef;
            if dict.is_null() || dict_i64(dict, kCGWindowLayer) != Some(0) {
                continue; // menu bar, Dock, overlays
            }
            // Front-to-back order: the first normal window is the frontmost.
            let app = dict_string(dict, kCGWindowOwnerName).unwrap_or_default();
            let title = if with_title { dict_string(dict, kCGWindowName).filter(|t| !t.is_empty()) } else { None };
            let bounds_ref = CFDictionaryGetValue(dict, kCGWindowBounds as *const c_void);
            let bounds = if bounds_ref.is_null() {
                None
            } else {
                let d: CFDictionary = CFDictionary::wrap_under_get_rule(bounds_ref as CFDictionaryRef);
                CGRect::from_dict_representation(&d).map(|r| Rect {
                    x: r.origin.x,
                    y: r.origin.y,
                    width: r.size.width,
                    height: r.size.height,
                })
            };
            let id = dict_i64(dict, kCGWindowNumber).unwrap_or(0) as u64;
            return Some(WindowInfo { id, app, title, bounds });
        }
    }
    None
}

pub fn available_space(dir: &std::path::Path) -> std::io::Result<u64> {
    super::unix_available_space(dir)
}
