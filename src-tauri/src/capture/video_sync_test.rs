//! Recording time against the pictures actually in the file: a small
//! topmost window turns black and white at known recording times (before
//! and after a pause), and ffmpeg finds those flips in screen.mp4.
//!
//! `cargo test --lib capture::video::live_sync -- --ignored --nocapture`
//! (needs a desktop session and ffmpeg: WIPECLIP_FFMPEG, or the engine's
//! imageio-ffmpeg in backend/.venv).

use super::*;
use std::sync::atomic::AtomicUsize;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{BeginPaint, EndPaint, FillRect, GetStockObject, InvalidateRect, BLACK_BRUSH, HBRUSH, PAINTSTRUCT, WHITE_BRUSH};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, PostMessageW, PostQuitMessage, RegisterClassW, TranslateMessage, MSG,
    WM_CLOSE, WM_DESTROY, WM_PAINT, WNDCLASSW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE,
};

static BLACK: AtomicBool = AtomicBool::new(false);
static PATCH: AtomicUsize = AtomicUsize::new(0);
const SIZE: i32 = 240;
const INSET: i32 = 60;

unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
        WM_PAINT => {
            let mut ps: PAINTSTRUCT = std::mem::zeroed();
            let dc = BeginPaint(hwnd, &mut ps);
            let brush = GetStockObject(if BLACK.load(Ordering::SeqCst) { BLACK_BRUSH } else { WHITE_BRUSH }) as HBRUSH;
            FillRect(dc, &ps.rcPaint, brush);
            EndPaint(hwnd, &ps);
            0
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, msg, wp, lp),
    }
}

/// The flashing window, on its own thread with a message loop.
fn spawn_patch(x: i32, y: i32) -> std::thread::JoinHandle<()> {
    let (tx, rx) = std::sync::mpsc::channel();
    let t = std::thread::spawn(move || unsafe {
        let class: Vec<u16> = "WipeClipSyncPatch\0".encode_utf16().collect();
        let module = GetModuleHandleW(std::ptr::null());
        let wc = WNDCLASSW { lpfnWndProc: Some(proc), hInstance: module, lpszClassName: class.as_ptr(), ..std::mem::zeroed() };
        RegisterClassW(&wc);
        let hwnd = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            class.as_ptr(),
            class.as_ptr(),
            WS_POPUP | WS_VISIBLE,
            x,
            y,
            SIZE,
            SIZE,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            module,
            std::ptr::null(),
        );
        tx.send(hwnd as usize).unwrap();
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    });
    PATCH.store(rx.recv().unwrap(), Ordering::SeqCst);
    t
}

fn flip(black: bool) {
    BLACK.store(black, Ordering::SeqCst);
    unsafe { InvalidateRect(PATCH.load(Ordering::SeqCst) as HWND, std::ptr::null(), 0) };
}

fn ffmpeg() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("WIPECLIP_FFMPEG") {
        return Some(PathBuf::from(p));
    }
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../backend/.venv/Lib/site-packages/imageio_ffmpeg/binaries");
    std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).find(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("ffmpeg")))
}

/// (pts seconds, mean luma) of every frame in a crop of the video.
fn frame_luma(ffmpeg: &Path, video: &Path, crop: (u32, u32, u32, u32)) -> Vec<(f64, f64)> {
    let (x, y, w, h) = crop;
    let out = std::process::Command::new(ffmpeg)
        .args(["-hide_banner", "-nostats", "-i"])
        .arg(video)
        .args(["-vf", &format!("crop={w}:{h}:{x}:{y},showinfo"), "-f", "null", "-"])
        .output()
        .expect("ffmpeg runs");
    let log = String::from_utf8_lossy(&out.stderr);
    let field = |line: &str, key: &str| -> Option<f64> {
        let rest = &line[line.find(key)? + key.len()..];
        rest.trim_start_matches('[').split(|c: char| c.is_whitespace() || c == ']').next()?.parse().ok()
    };
    log.lines().filter(|l| l.contains("Parsed_showinfo")).filter_map(|l| Some((field(l, "pts_time:")?, field(l, "mean:")?))).collect()
}

#[test]
#[ignore]
fn flips_in_the_file_match_the_clock() {
    let Some(ffmpeg) = ffmpeg() else {
        println!("skipped: no ffmpeg (set WIPECLIP_FFMPEG)");
        return;
    };
    let primary = super::super::sources::list().into_iter().find(|s| s.kind == "monitor" && s.primary).expect("a primary display");
    let (bx, by) = (primary.bounds.x as i32, primary.bounds.y as i32);
    let ui = spawn_patch(bx + 20, by + 20);
    std::thread::sleep(Duration::from_millis(500)); // shown and composed

    let dir = std::env::temp_dir().join(format!("wipeclip-sync-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    let fps = 30u32;
    let o = StartOptions { recording: String::new(), source: primary.id.clone(), fps, max_height: None, bitrate: 6_000_000, cursor: false, system_audio: false };
    let (a, started) = Active::start(&dir, &o, Instant::now()).unwrap();
    let t0 = Instant::now();
    let at = |ms: u64| std::thread::sleep(Duration::from_millis(ms).saturating_sub(t0.elapsed()));
    let rec_s = |a: &Active| a.clock.rec_time(qpc_now()).expect("recording") as f64 / TICKS_PER_SEC as f64;
    let mut flips = Vec::new();
    for (ms, black) in [(1000, true), (2000, false)] {
        at(ms);
        flip(black);
        flips.push(rec_s(&a));
    }
    at(2400);
    a.set_paused(true, None);
    at(3400);
    a.set_paused(false, None);
    for (ms, black) in [(4000, true), (5000, false)] {
        at(ms);
        flip(black);
        flips.push(rec_s(&a));
    }
    at(5800);
    let stopped = a.stop(None).unwrap();
    unsafe { PostMessageW(PATCH.load(Ordering::SeqCst) as HWND, WM_CLOSE, 0, 0) };
    ui.join().unwrap();

    // The patch's middle in video pixels. Works at any DPI scaling: the
    // window is at least SIZE physical pixels.
    let sx = started.width as f64 / primary.bounds.width;
    let sy = started.height as f64 / primary.bounds.height;
    let side = (SIZE - 2 * INSET) as f64;
    let crop = (((20 + INSET) as f64 * sx) as u32, ((20 + INSET) as f64 * sy) as u32, (side * sx) as u32 & !1, (side * sy) as u32 & !1);
    let video = dir.join(SCREEN_FILE);
    let frames = frame_luma(&ffmpeg, &video, crop);
    let v = super::live::duration_s(&video);
    std::fs::remove_dir_all(&dir).unwrap();
    println!("{} frames decoded, file {v:.3} s, clock {:.3} s, {} dropped", frames.len(), stopped.duration_ms / 1000.0, stopped.dropped);

    let seen: Vec<f64> = frames.windows(2).filter(|w| (w[0].1 < 128.0) != (w[1].1 < 128.0)).map(|w| w[1].0).collect();
    println!("flips at {flips:.3?} s (recording time), seen in the file at {seen:.3?} s");
    assert_eq!(seen.len(), flips.len(), "every flip shows up once, nothing from the pause");
    let frame = 1.0 / fps as f64;
    for (f, s) in flips.iter().zip(&seen) {
        let d = s - f;
        println!("flip {f:.3} s -> file {s:.3} s: {:+.1} ms", d * 1000.0);
        // Never before it happened (beyond frame rounding); at most the
        // paint + compose + one frame interval after it.
        assert!(d > -frame && d < 0.1 + frame, "flip at {f:.3} s shows at {s:.3} s");
    }
    assert!((v - stopped.duration_ms / 1000.0).abs() < 0.1);
}

/// A window that protects its content (WDA_MONITOR, what DRM players and
/// some password managers use) is recorded without its content: black,
/// not the white it shows on the monitor. Documents a limit, doesn't
/// work around it.
#[test]
#[ignore]
fn protected_window_records_without_content() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_MONITOR};
    let Some(ffmpeg) = ffmpeg() else {
        println!("skipped: no ffmpeg (set WIPECLIP_FFMPEG)");
        return;
    };
    let primary = super::super::sources::list().into_iter().find(|s| s.kind == "monitor" && s.primary).expect("a primary display");
    BLACK.store(false, Ordering::SeqCst);
    let ui = spawn_patch(primary.bounds.x as i32 + 20, primary.bounds.y as i32 + 20);
    assert_ne!(unsafe { SetWindowDisplayAffinity(PATCH.load(Ordering::SeqCst) as HWND, WDA_MONITOR) }, 0);
    std::thread::sleep(Duration::from_millis(500));
    let dir = std::env::temp_dir().join(format!("wipeclip-protected-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    let o = StartOptions { recording: String::new(), source: primary.id.clone(), fps: 30, max_height: None, bitrate: 6_000_000, cursor: false, system_audio: false };
    let (a, started) = Active::start(&dir, &o, Instant::now()).unwrap();
    std::thread::sleep(Duration::from_millis(1500));
    a.stop(None).unwrap();
    unsafe { PostMessageW(PATCH.load(Ordering::SeqCst) as HWND, WM_CLOSE, 0, 0) };
    ui.join().unwrap();
    let sx = started.width as f64 / primary.bounds.width;
    let sy = started.height as f64 / primary.bounds.height;
    let side = (SIZE - 2 * INSET) as f64;
    let crop = (((20 + INSET) as f64 * sx) as u32, ((20 + INSET) as f64 * sy) as u32, (side * sx) as u32 & !1, (side * sy) as u32 & !1);
    let frames = frame_luma(&ffmpeg, &dir.join(SCREEN_FILE), crop);
    std::fs::remove_dir_all(&dir).unwrap();
    let max = frames.iter().map(|f| f.1).fold(0.0, f64::max);
    println!("{} frames, brightest luma in the protected window's area: {max:.0} (white would be ~235)", frames.len());
    assert!(!frames.is_empty() && max < 64.0, "protected content showed up in the recording");
}

/// A long recording (WIPECLIP_LIVE_SECS, default 600) of the primary
/// display with system audio: no frames dropped, files growing steadily,
/// lengths matching the clock at the end. Memory is watched from outside
/// (the test process's working set), see docs/desktop/RECORDER.md.
#[test]
#[ignore]
fn long_session() {
    let secs: u64 = std::env::var("WIPECLIP_LIVE_SECS").ok().and_then(|s| s.parse().ok()).unwrap_or(600);
    let primary = super::super::sources::list().into_iter().find(|s| s.kind == "monitor" && s.primary).expect("a primary display");
    let dir = std::env::temp_dir().join(format!("wipeclip-long-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    let o = StartOptions { recording: String::new(), source: primary.id.clone(), fps: 30, max_height: None, bitrate: 6_000_000, cursor: true, system_audio: true };
    let (a, started) = Active::start(&dir, &o, Instant::now()).unwrap();
    println!("started {}x{} encoder {} audio {}", started.width, started.height, started.encoder, started.system_audio);
    let t0 = Instant::now();
    let mut last = 0u64;
    while t0.elapsed() < Duration::from_secs(secs) {
        std::thread::sleep(Duration::from_secs(30).min(Duration::from_secs(secs).saturating_sub(t0.elapsed())));
        let s = a.status();
        println!(
            "{:>4} s: {} frames, {} dropped, screen {:.1} MB (+{:.1}), audio {:.1} MB, ended {:?}",
            t0.elapsed().as_secs(),
            s.frames,
            s.dropped,
            s.screen_bytes as f64 / 1e6,
            (s.screen_bytes - last) as f64 / 1e6,
            s.audio_bytes as f64 / 1e6,
            s.ended
        );
        assert!(s.ended.is_none());
        assert!(s.screen_bytes > last, "the screen file keeps growing");
        last = s.screen_bytes;
    }
    let stopped = a.stop(None).unwrap();
    let v = super::live::duration_s(&dir.join(SCREEN_FILE));
    let au = super::live::duration_s(&dir.join(AUDIO_FILE));
    println!("stopped: clock {:.3} s, video {v:.3} s, audio {au:.3} s, {} frames, {} dropped, {:?}", stopped.duration_ms / 1000.0, stopped.frames, stopped.dropped, stopped.warnings);
    println!("kept in {}", dir.display());
    assert_eq!(stopped.dropped, 0);
    assert!((v - stopped.duration_ms / 1000.0).abs() < 0.1);
    assert!((au - stopped.duration_ms / 1000.0).abs() < 0.1);
}
