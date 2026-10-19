//! What can be recorded: connected displays and top-level app windows, and
//! a GDI still of each for the picker and the setup preview.

use std::ffi::c_void;

use windows::core::{BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, EnumDisplayMonitors, GetDC, GetMonitorInfoW, ReleaseDC, SelectObject,
    SetBrushOrgEx, SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HALFTONE, HBITMAP, HDC, HMONITOR,
    MONITORINFO, MONITORINFOEXW, SRCCOPY,
};
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::System::Threading::{GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetAncestor, GetClassNameW, GetWindow, GetWindowLongW, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    IsIconic, IsWindowVisible, SetWindowDisplayAffinity, GA_ROOT, GWL_EXSTYLE, GW_OWNER, MONITORINFOF_PRIMARY, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

use super::CaptureSource;
use crate::input::Rect;

pub enum Target {
    Monitor(HMONITOR),
    Window(HWND),
}

pub fn parse_id(id: &str) -> Result<Target, String> {
    let bad = || "Unknown capture source.".to_string();
    let (kind, n) = id.split_once(':').ok_or_else(bad)?;
    let n: isize = n.parse().map_err(|_| bad())?;
    match kind {
        "monitor" => Ok(Target::Monitor(HMONITOR(n as *mut c_void))),
        "window" => Ok(Target::Window(HWND(n as *mut c_void))),
        _ => Err(bad()),
    }
}

fn wide(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

fn rect(r: RECT) -> Rect {
    Rect { x: r.left as f64, y: r.top as f64, width: (r.right - r.left) as f64, height: (r.bottom - r.top) as f64 }
}

pub struct MonitorInfo {
    pub handle: HMONITOR,
    pub device: String,
    pub bounds: RECT,
    pub primary: bool,
}

pub fn monitors() -> Vec<MonitorInfo> {
    unsafe extern "system" fn each(m: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
        let out = unsafe { &mut *(data.0 as *mut Vec<MonitorInfo>) };
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        if unsafe { GetMonitorInfoW(m, &mut info as *mut MONITORINFOEXW as *mut MONITORINFO) }.as_bool() {
            out.push(MonitorInfo {
                handle: m,
                device: wide(&info.szDevice),
                bounds: info.monitorInfo.rcMonitor,
                primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
            });
        }
        true.into()
    }
    let mut out: Vec<MonitorInfo> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(each), LPARAM(&mut out as *mut _ as isize));
    }
    out
}

/// Bounds without the invisible resize border/shadow.
pub fn window_bounds(hwnd: HWND) -> Option<RECT> {
    let mut r = RECT::default();
    let ok = unsafe { DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &mut r as *mut RECT as *mut c_void, std::mem::size_of::<RECT>() as u32) };
    if ok.is_ok() {
        return Some(r);
    }
    unsafe { GetWindowRect(hwnd, &mut r) }.ok().map(|_| r)
}

fn process_name(pid: u32) -> Option<String> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let r = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(h);
        r.ok()?;
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        let file = path.rsplit(['\\', '/']).next()?.to_string();
        Some(file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(&file).to_string())
    }
}

fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    let r = unsafe { DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut c_void, 4) };
    r.is_ok() && cloaked != 0
}

/// Windows a person would call "an app window": visible, titled, top
/// level, not a tool window, not cloaked (other virtual desktop, suspended
/// UWP), not this app.
fn capturable_window(hwnd: HWND) -> Option<CaptureSource> {
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() || GetAncestor(hwnd, GA_ROOT) != hwnd || is_cloaked(hwnd) {
            return None;
        }
        let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        let owned = GetWindow(hwnd, GW_OWNER).map(|o| !o.is_invalid()).unwrap_or(false);
        if ex & WS_EX_TOOLWINDOW.0 != 0 || (ex & WS_EX_NOACTIVATE.0 != 0 && ex & WS_EX_APPWINDOW.0 == 0) || (owned && ex & WS_EX_APPWINDOW.0 == 0) {
            return None;
        }
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return None;
        }
        let mut buf = vec![0u16; len as usize + 1];
        GetWindowTextW(hwnd, &mut buf);
        let title = wide(&buf);
        let mut class = [0u16; 256];
        GetClassNameW(hwnd, &mut class);
        let class = wide(&class);
        if matches!(class.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd") || title.trim().is_empty() {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == GetCurrentProcessId() {
            return None;
        }
        let minimized = IsIconic(hwnd).as_bool();
        let b = window_bounds(hwnd)?;
        if !minimized && (b.right - b.left < 64 || b.bottom - b.top < 48) {
            return None;
        }
        Some(CaptureSource {
            id: format!("window:{}", hwnd.0 as isize),
            kind: "window",
            name: title,
            app: process_name(pid),
            bounds: rect(b),
            primary: false,
            display_id: None,
            minimized,
        })
    }
}

pub fn list() -> Vec<CaptureSource> {
    let mut out: Vec<CaptureSource> = monitors()
        .into_iter()
        .enumerate()
        .map(|(i, m)| CaptureSource {
            id: format!("monitor:{}", m.handle.0 as isize),
            kind: "monitor",
            name: format!("Display {}", i + 1),
            app: None,
            bounds: rect(m.bounds),
            primary: m.primary,
            // Matches recorder_displays (Tauri names monitors by device).
            display_id: Some(format!("{}@{},{}", m.device, m.bounds.left, m.bounds.top)),
            minimized: false,
        })
        .collect();
    // Primary first.
    out.sort_by_key(|s| !s.primary);
    for (i, s) in out.iter_mut().enumerate() {
        s.name = if s.primary { format!("Display {} (main)", i + 1) } else { format!("Display {}", i + 1) };
    }

    unsafe extern "system" fn each(hwnd: HWND, data: LPARAM) -> BOOL {
        let out = unsafe { &mut *(data.0 as *mut Vec<CaptureSource>) };
        if let Some(s) = capturable_window(hwnd) {
            out.push(s);
        }
        true.into()
    }
    let mut windows: Vec<CaptureSource> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(each), LPARAM(&mut windows as *mut _ as isize));
    }
    out.extend(windows);
    out
}

struct Dib {
    dc: HDC,
    bitmap: HBITMAP,
    old: windows::Win32::Graphics::Gdi::HGDIOBJ,
    bits: *mut u8,
    w: i32,
    h: i32,
}

impl Dib {
    fn new(reference: HDC, w: i32, h: i32) -> Result<Dib, String> {
        unsafe {
            let dc = CreateCompatibleDC(Some(reference));
            if dc.is_invalid() {
                return Err("Couldn't create a drawing surface.".into());
            }
            let bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h, // top-down
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits: *mut c_void = std::ptr::null_mut();
            let bitmap = match CreateDIBSection(Some(dc), &bmi, DIB_RGB_COLORS, &mut bits, None, 0) {
                Ok(b) => b,
                Err(e) => {
                    let _ = DeleteDC(dc);
                    return Err(e.message());
                }
            };
            let old = SelectObject(dc, bitmap.into());
            Ok(Dib { dc, bitmap, old, bits: bits as *mut u8, w, h })
        }
    }

    /// BGRA (alpha undefined) to RGBA, opaque.
    fn rgba(&self) -> Vec<u8> {
        let n = (self.w * self.h * 4) as usize;
        let src = unsafe { std::slice::from_raw_parts(self.bits, n) };
        let mut out = vec![0u8; n];
        for (o, s) in out.chunks_exact_mut(4).zip(src.chunks_exact(4)) {
            o[0] = s[2];
            o[1] = s[1];
            o[2] = s[0];
            o[3] = 255;
        }
        out
    }
}

impl Drop for Dib {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.dc, self.old);
            let _ = DeleteObject(self.bitmap.into());
            let _ = DeleteDC(self.dc);
        }
    }
}

fn fit(w: i32, h: i32, max_w: u32, max_h: u32) -> (i32, i32) {
    let s = (max_w as f64 / w as f64).min(max_h as f64 / h as f64).min(1.0);
    (((w as f64 * s).round() as i32).max(1), ((h as f64 * s).round() as i32).max(1))
}

fn stretch(dst: &Dib, src: HDC, sx: i32, sy: i32, sw: i32, sh: i32) {
    unsafe {
        SetStretchBltMode(dst.dc, HALFTONE);
        let _ = SetBrushOrgEx(dst.dc, 0, 0, None);
        let _ = StretchBlt(dst.dc, 0, 0, dst.w, dst.h, Some(src), sx, sy, sw, sh, SRCCOPY);
    }
}

pub fn thumbnail(id: &str, max_w: u32, max_h: u32) -> Result<(u32, u32, Vec<u8>), String> {
    unsafe {
        let screen = GetDC(None);
        let result = (|| match parse_id(id)? {
            Target::Monitor(m) => {
                let info = monitors().into_iter().find(|i| i.handle == m).ok_or("That display isn't connected any more.")?;
                let r = info.bounds;
                let (w, h) = (r.right - r.left, r.bottom - r.top);
                let (tw, th) = fit(w, h, max_w, max_h);
                let dib = Dib::new(screen, tw, th)?;
                stretch(&dib, screen, r.left, r.top, w, h);
                Ok((tw as u32, th as u32, dib.rgba()))
            }
            Target::Window(hwnd) => {
                if IsIconic(hwnd).as_bool() {
                    return Err("The window is minimized.".to_string());
                }
                let mut wr = RECT::default();
                GetWindowRect(hwnd, &mut wr).map_err(|_| "That window was closed.")?;
                let vis = window_bounds(hwnd).unwrap_or(wr);
                let (fw, fh) = (wr.right - wr.left, wr.bottom - wr.top);
                if fw <= 0 || fh <= 0 {
                    return Err("That window has no size.".to_string());
                }
                let full = Dib::new(screen, fw, fh)?;
                // PW_RENDERFULLCONTENT: also GPU-drawn content (browsers, Office).
                let _ = PrintWindow(hwnd, full.dc, PRINT_WINDOW_FLAGS(2));
                let (cx, cy) = (vis.left - wr.left, vis.top - wr.top);
                let (cw, ch) = ((vis.right - vis.left).min(fw - cx), (vis.bottom - vis.top).min(fh - cy));
                let (tw, th) = fit(cw.max(1), ch.max(1), max_w, max_h);
                let dib = Dib::new(screen, tw, th)?;
                stretch(&dib, full.dc, cx, cy, cw.max(1), ch.max(1));
                Ok((tw as u32, th as u32, dib.rgba()))
            }
        })();
        ReleaseDC(None, screen);
        result
    }
}

pub fn exclude_from_capture(hwnd: *mut c_void, exclude: bool) -> Result<(), String> {
    unsafe { SetWindowDisplayAffinity(HWND(hwnd), if exclude { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE }) }.map_err(|e| e.message())
}
