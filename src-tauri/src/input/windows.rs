//! Windows input monitor: low-level mouse/keyboard hooks (WH_MOUSE_LL,
//! WH_KEYBOARD_LL) on a dedicated thread with its own message loop, cursor
//! polling with GetCursorPos, and the foreground window via
//! GetForegroundWindow + DWM bounds.
//!
//! No permission prompt exists on Windows for any of this. Limits: input
//! going to a window of an elevated (administrator) app isn't delivered to
//! a non-elevated app's hooks (UIPI), and the secure desktop (UAC prompts,
//! Ctrl+Alt+Del) is never visible.
//!
//! Coordinates are physical pixels in the virtual-desktop space: the app
//! is per-monitor DPI aware (tauri-build's manifest), so hooks and
//! GetCursorPos report unscaled positions, matching Tauri's monitor bounds.
//!
//! The hook procedures must return quickly - Windows silently removes a
//! low-level hook that keeps input waiting (LowLevelHooksTimeout) - so they
//! only push a small event into the shared buffer.

use std::ptr::{null, null_mut};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};

use windows_sys::Win32::Foundation::{CloseHandle, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Threading::{
    GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetCursorPos, GetForegroundWindow, GetGUIThreadInfo, GetMessageW, GUITHREADINFO, GetWindowTextW,
    GetWindowThreadProcessId, PeekMessageW, PostThreadMessageW, SetWindowsHookExW, TranslateMessage,
    UnhookWindowsHookEx, HC_ACTION, KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT, PM_NOREMOVE, WH_KEYBOARD_LL, WH_MOUSE_LL,
    WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP, WM_MOUSEHWHEEL, WM_MOUSEWHEEL,
    WM_QUIT, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_SYSKEYDOWN, WM_SYSKEYUP, WM_USER, WM_XBUTTONDOWN, WM_XBUTTONUP,
};

use super::keys::{self, Modifiers, Platform};
use super::{Permission, Permissions, RawEvent, Rect, Sink, WindowInfo};

/// The running hooks' destination. Hook procedures get no user data, so
/// it's process-global; only one monitor runs at a time.
static SINK: Mutex<Option<Arc<Sink>>> = Mutex::new(None);
/// Keys currently held, to skip auto-repeat.
static HELD: Mutex<Vec<u32>> = Mutex::new(Vec::new());

fn sink() -> Option<Arc<Sink>> {
    SINK.lock().ok().and_then(|s| s.clone())
}

pub fn permissions() -> Permissions {
    Permissions {
        mouse: Permission::Granted,
        keyboard: Permission::Granted,
        active_window: Permission::Granted,
    }
}

pub fn request_keyboard_access() {}

pub fn cursor_position() -> Option<(f64, f64)> {
    let mut p = POINT { x: 0, y: 0 };
    // SAFETY: valid out pointer.
    (unsafe { GetCursorPos(&mut p) } != 0).then_some((p.x as f64, p.y as f64))
}

const WHEEL_DELTA: f64 = 120.0;

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        if let Some(sink) = sink() {
            // SAFETY: for WH_MOUSE_LL with HC_ACTION, lparam points to an MSLLHOOKSTRUCT.
            let info = unsafe { &*(lparam as *const MSLLHOOKSTRUCT) };
            let (x, y) = (info.pt.x as f64, info.pt.y as f64);
            let wheel = ((info.mouseData >> 16) as u16 as i16) as f64 / WHEEL_DELTA;
            let t = sink.now_us();
            let button = |button: &'static str, down: bool| RawEvent::Button { t, button, down, x, y };
            let event = match wparam as u32 {
                WM_LBUTTONDOWN => Some(button("left", true)),
                WM_LBUTTONUP => Some(button("left", false)),
                WM_RBUTTONDOWN => Some(button("right", true)),
                WM_RBUTTONUP => Some(button("right", false)),
                WM_MBUTTONDOWN => Some(button("middle", true)),
                WM_MBUTTONUP => Some(button("middle", false)),
                WM_XBUTTONDOWN => Some(button("other", true)),
                WM_XBUTTONUP => Some(button("other", false)),
                // Positive wheel delta = rotated away from the user = scroll up;
                // recorded dy is positive for scrolling down.
                WM_MOUSEWHEEL => Some(RawEvent::Scroll { t, dx: 0.0, dy: -wheel, x, y }),
                WM_MOUSEHWHEEL => Some(RawEvent::Scroll { t, dx: wheel, dy: 0.0, x, y }),
                _ => None, // moves come from polling, see super::poll
            };
            if let Some(event) = event {
                sink.push_pointer(event);
            }
        }
    }
    // SAFETY: passes the event on unchanged; the hook never swallows input.
    unsafe { CallNextHookEx(null_mut(), code, wparam, lparam) }
}

fn key_down(vk: i32) -> bool {
    // SAFETY: plain query. High bit = currently down.
    (unsafe { GetAsyncKeyState(vk) } as u16 & 0x8000) != 0
}

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        if let Some(sink) = sink() {
            // SAFETY: for WH_KEYBOARD_LL with HC_ACTION, lparam points to a KBDLLHOOKSTRUCT.
            let info = unsafe { &*(lparam as *const KBDLLHOOKSTRUCT) };
            let vk = info.vkCode;
            let msg = wparam as u32;
            if let Ok(mut held) = HELD.lock() {
                if msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN {
                    let repeat = held.contains(&vk);
                    if !repeat {
                        held.push(vk);
                        // Modifier state from before this key (GetAsyncKeyState
                        // doesn't include the event being processed yet).
                        let m = Modifiers {
                            ctrl: key_down(0x11),
                            alt: key_down(0x12),
                            shift: key_down(0x10),
                            meta: key_down(0x5B) || key_down(0x5C),
                        };
                        if let Some(label) = keys::windows_key(vk).and_then(|k| keys::shortcut_label(k, m, Platform::Windows)) {
                            sink.push_shortcut(label);
                        } else if !is_modifier(vk) {
                            sink.push_typing(caret_rect);
                        }
                    }
                } else if msg == WM_KEYUP || msg == WM_SYSKEYUP {
                    held.retain(|k| *k != vk);
                }
            }
        }
    }
    // SAFETY: as above.
    unsafe { CallNextHookEx(null_mut(), code, wparam, lparam) }
}

/// Shift, Ctrl, Alt, Win, Caps Lock on their own aren't typing.
fn is_modifier(vk: u32) -> bool {
    matches!(vk, 0x10..=0x12 | 0x14 | 0x5B | 0x5C | 0xA0..=0xA5)
}

/// The focused app's text cursor (system caret), desktop coordinates.
/// Many apps keep one even when they draw their own (browsers, Office,
/// editors - for accessibility tools); None when there isn't one.
fn caret_rect() -> Option<Rect> {
    caret_rect_of(0) // 0 = the foreground thread
}

fn caret_rect_of(thread: u32) -> Option<Rect> {
    // SAFETY: plain queries with valid out pointers.
    unsafe {
        let mut info: GUITHREADINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
        if GetGUIThreadInfo(thread, &mut info) == 0 || info.hwndCaret.is_null() {
            return None;
        }
        let r = info.rcCaret;
        let h = r.bottom - r.top;
        if h <= 0 || h > 400 {
            return None;
        }
        let mut p = POINT { x: r.left, y: r.top };
        if ClientToScreen(info.hwndCaret, &mut p) == 0 {
            return None;
        }
        Some(Rect { x: p.x as f64, y: p.y as f64, width: (r.right - r.left).max(1) as f64, height: h as f64 })
    }
}

pub struct Hooks {
    thread_id: u32,
    join: Option<JoinHandle<()>>,
}

/// Installs the requested hooks. Returns warnings for hooks Windows
/// refused (rare: e.g. some security software blocks them).
pub fn start_hooks(target: Arc<Sink>, mouse: bool, keyboard: bool) -> Result<(Hooks, Vec<String>), String> {
    *SINK.lock().map_err(|_| "input state poisoned")? = Some(target);
    if let Ok(mut held) = HELD.lock() {
        held.clear();
    }
    let (tx, rx) = mpsc::channel::<(u32, bool, bool)>();
    let join = thread::Builder::new()
        .name("wipeclip-input-hooks".into())
        .spawn(move || unsafe {
            // SAFETY: standard hook installation on this thread; the
            // message loop below is what delivers the hook calls.
            let module = GetModuleHandleW(null());
            let mh = if mouse { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), module, 0) } else { null_mut() };
            let kh = if keyboard { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), module, 0) } else { null_mut() };
            // Make sure this thread has a message queue before anyone posts WM_QUIT to it.
            let mut msg: MSG = std::mem::zeroed();
            PeekMessageW(&mut msg, null_mut(), WM_USER, WM_USER, PM_NOREMOVE);
            let _ = tx.send((GetCurrentThreadId(), mouse && mh.is_null(), keyboard && kh.is_null()));
            while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            if !mh.is_null() {
                UnhookWindowsHookEx(mh);
            }
            if !kh.is_null() {
                UnhookWindowsHookEx(kh);
            }
        })
        .map_err(|e| format!("couldn't start the input monitor: {e}"))?;
    let (thread_id, mouse_failed, keyboard_failed) =
        rx.recv().map_err(|_| "the input monitor stopped unexpectedly".to_string())?;
    let mut warnings = Vec::new();
    if mouse_failed {
        warnings.push("Windows didn't allow monitoring mouse clicks and scrolling.".to_string());
    }
    if keyboard_failed {
        warnings.push("Windows didn't allow monitoring the keyboard (shortcuts, typing).".to_string());
    }
    Ok((Hooks { thread_id, join: Some(join) }, warnings))
}

impl Hooks {
    pub fn stop(mut self) {
        // SAFETY: posting to a thread we own; it exits its loop on WM_QUIT.
        unsafe { PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0) };
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
        if let Ok(mut s) = SINK.lock() {
            *s = None;
        }
    }
}

fn wide_to_string(buf: &[u16]) -> String {
    String::from_utf16_lossy(buf)
}

fn process_name(hwnd: HWND) -> Option<String> {
    let mut pid = 0u32;
    // SAFETY: valid hwnd from GetForegroundWindow (may be stale; calls then fail harmlessly).
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    if pid == 0 {
        return None;
    }
    // SAFETY: handle is closed below; the buffer length is passed in/out.
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return None;
        }
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(process, 0, buf.as_mut_ptr(), &mut len) != 0;
        CloseHandle(process);
        if !ok {
            return None;
        }
        let path = wide_to_string(&buf[..len as usize]);
        let file = path.rsplit(['\\', '/']).next().unwrap_or(&path);
        Some(file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file).to_string())
    }
}

pub fn foreground_window(with_title: bool) -> Option<WindowInfo> {
    // SAFETY: plain queries on the foreground window handle.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }
        let app = process_name(hwnd).unwrap_or_default();
        let title = if with_title {
            let mut buf = [0u16; 512];
            let n = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
            (n > 0).then(|| wide_to_string(&buf[..n as usize]))
        } else {
            None
        };
        let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        let ok = DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS as u32,
            &mut r as *mut RECT as *mut _,
            std::mem::size_of::<RECT>() as u32,
        ) == 0;
        let bounds = ok.then(|| Rect {
            x: r.left as f64,
            y: r.top as f64,
            width: (r.right - r.left) as f64,
            height: (r.bottom - r.top) as f64,
        });
        Some(WindowInfo { id: hwnd as usize as u64, app, title, bounds })
    }
}

pub fn available_space(dir: &std::path::Path) -> std::io::Result<u64> {
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut free = 0u64;
    // SAFETY: NUL-terminated path; optional out params may be null.
    let ok = unsafe { GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, null_mut(), null_mut()) } != 0;
    if ok {
        Ok(free)
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(test)]
mod tests {
    use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{CreateCaret, CreateWindowExW, DestroyCaret, DestroyWindow, SetCaretPos, WS_OVERLAPPEDWINDOW};

    #[test]
    fn caret_is_read_in_desktop_coordinates() {
        let class: Vec<u16> = "STATIC ".encode_utf16().collect();
        // SAFETY: a hidden test window on this thread, destroyed at the end.
        unsafe {
            let hwnd = CreateWindowExW(0, class.as_ptr(), std::ptr::null(), WS_OVERLAPPEDWINDOW, 200, 150, 400, 300, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null());
            assert!(!hwnd.is_null());
            assert_eq!(super::caret_rect_of(GetCurrentThreadId()), None, "no caret yet");
            assert!(CreateCaret(hwnd, std::ptr::null_mut(), 2, 20) != 0);
            SetCaretPos(10, 30);
            let mut origin = POINT { x: 0, y: 0 };
            ClientToScreen(hwnd, &mut origin);
            let r = super::caret_rect_of(GetCurrentThreadId()).expect("caret");
            assert_eq!((r.x, r.y, r.width, r.height), ((origin.x + 10) as f64, (origin.y + 30) as f64, 2.0, 20.0));
            DestroyCaret();
            DestroyWindow(hwnd);
        }
    }
}

