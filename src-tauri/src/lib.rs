//! WipeClip desktop shell. The UI is the website's editor, built as static
//! files (desktop/) and bundled into the app; everything account- and
//! billing-related still happens on wipeclip.co, while video processing runs
//! on a bundled copy of the backend (engine.rs). This crate only adds what a
//! browser can't do safely on its own:
//! saving exports to a folder the user picks, keeping the sign-in session in
//! the OS credential store, opening links in the system browser, the
//! wipeclip:// sign-in return link, and the screen recorder's native half
//! (recording files, interaction metadata, hotkeys - see docs/desktop/RECORDER.md).

mod capture;
mod engine;
mod export;
mod input;
mod links;
mod recording;
mod secure_storage;
mod shortcuts;
mod updater;

use serde::Serialize;
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_log::{Target, TargetKind};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopCapabilities {
    desktop: bool,
    native_save: bool,
    platform: &'static str,
    version: String,
}

#[tauri::command]
fn desktop_capabilities(app: tauri::AppHandle) -> DesktopCapabilities {
    DesktopCapabilities {
        desktop: true,
        native_save: true,
        platform: if cfg!(windows) {
            "windows"
        } else if cfg!(target_os = "macos") {
            "macos"
        } else {
            "linux"
        },
        version: app.package_info().version.to_string(),
    }
}

/// Native error dialog for failures the editor UI can't show itself.
#[tauri::command]
fn show_error(app: tauri::AppHandle, title: String, message: String) {
    log::error!("{title}: {message}");
    app.dialog()
        .message(truncate(&message, 2000))
        .title(truncate(&title, 120))
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

/// A native OK/Cancel confirmation. The dialog plugin replaces
/// window.confirm with an async version (a Promise, always truthy), so the
/// page must never rely on window.confirm in the desktop app - it calls
/// this instead (src/lib/platform confirmAction).
#[tauri::command]
async fn confirm_action(app: tauri::AppHandle, title: String, message: String, ok_label: String) -> bool {
    app.dialog()
        .message(truncate(&message, 2000))
        .title(truncate(&title, 120))
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(truncate(&ok_label, 40), "Cancel".into()))
        .blocking_show()
}

/// Uncaught frontend errors, so they end up in the log file users can send us.
#[tauri::command]
fn frontend_log(level: String, message: String) {
    let message = truncate(&message, 4000);
    match level.as_str() {
        "error" => log::error!(target: "frontend", "{message}"),
        "warn" => log::warn!(target: "frontend", "{message}"),
        _ => log::info!(target: "frontend", "{message}"),
    }
}

fn truncate(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DisplayInfo {
    id: String,
    name: String,
    bounds: input::Rect,
    scale_factor: f64,
    primary: bool,
}

/// Connected displays in the input monitor's desktop coordinates (physical
/// pixels on Windows, points on macOS - CGEvent locations are in points,
/// while Tauri reports macOS monitors as points times the scale factor).
#[tauri::command]
fn recorder_displays(app: tauri::AppHandle) -> Result<Vec<DisplayInfo>, String> {
    let primary = app.primary_monitor().ok().flatten().map(|m| *m.position());
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    Ok(monitors
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let (pos, size, scale) = (m.position(), m.size(), m.scale_factor());
            let unit = if cfg!(target_os = "macos") { scale } else { 1.0 };
            DisplayInfo {
                id: format!("{}@{},{}", m.name().cloned().unwrap_or_else(|| format!("display-{i}")), pos.x, pos.y),
                name: m.name().cloned().unwrap_or_else(|| format!("Display {}", i + 1)),
                bounds: input::Rect {
                    x: pos.x as f64 / unit,
                    y: pos.y as f64 / unit,
                    width: size.width as f64 / unit,
                    height: size.height as f64 / unit,
                },
                scale_factor: scale,
                primary: primary == Some(*pos),
            }
        })
        .collect())
}

/// Minimizes or restores the app window around a recording, so it isn't
/// in the shot.
#[tauri::command]
fn recorder_window(window: tauri::WebviewWindow, minimize: bool) -> Result<(), String> {
    if minimize {
        window.minimize().map_err(|e| e.to_string())
    } else {
        window.unminimize().and_then(|_| window.set_focus()).map_err(|e| e.to_string())
    }
}

const MINI_LABEL: &str = "recorder-mini";

/// The recording mini player: a small always-on-top window with a live
/// preview, the timer and Pause/Stop. It is excluded from screen capture,
/// so it never appears in the recording. Async: creating a window from a
/// synchronous command deadlocks on Windows.
#[tauri::command]
async fn recorder_mini(app: tauri::AppHandle, show: bool) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(MINI_LABEL) {
        if show {
            return Ok(());
        }
        return w.close().map_err(|e| e.to_string());
    }
    if !show {
        return Ok(());
    }
    let (w, h) = (320.0, 236.0);
    let window = WebviewWindowBuilder::new(&app, MINI_LABEL, WebviewUrl::App("mini/".into()))
        .title("WipeClip recording")
        .inner_size(w, h)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .on_navigation(links::is_app_url)
        .build()
        .map_err(|e| e.to_string())?;
    // Out of the video before it is ever shown.
    if let Err(e) = capture::exclude_window(&window, true) {
        log::warn!("mini player not excluded from capture: {e}");
        let _ = window.close();
        return Err("The mini player can't be hidden from the recording on this system.".into());
    }
    // Bottom-right of the main window's display, above the taskbar.
    let monitor = app
        .get_webview_window("main")
        .and_then(|mw| mw.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let s = m.scale_factor();
        let (pos, size) = (m.position(), m.size());
        let x = pos.x + size.width as i32 - ((w + 24.0) * s) as i32;
        let y = pos.y + size.height as i32 - ((h + 72.0) * s) as i32;
        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    }
    window.show().map_err(|e| e.to_string())
}

/// Opens the OS privacy settings page for a recorder permission. Fixed
/// targets only - the page can't open arbitrary URLs through this.
#[tauri::command]
fn open_privacy_settings(app: tauri::AppHandle, kind: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let url = if cfg!(target_os = "macos") {
        match kind.as_str() {
            "screen" => "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
            "microphone" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
            "camera" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
            "input" => "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
            _ => return Err("Unknown setting.".into()),
        }
    } else if cfg!(windows) {
        match kind.as_str() {
            "microphone" => "ms-settings:privacy-microphone",
            "camera" => "ms-settings:privacy-webcam",
            "screen" | "input" => "ms-settings:privacy",
            _ => return Err("Unknown setting.".into()),
        }
    } else {
        return Err("Not available on this platform.".into());
    };
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// Opens the bundled third-party notices (desktop/scripts/notices.mjs) in
/// the default text viewer. Fixed path - the page can't name another file.
#[tauri::command]
fn open_notices(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = app
        .path()
        .resolve("THIRD-PARTY-NOTICES.txt", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    if !path.is_file() {
        return Err("The licence file isn't part of this build.".into());
    }
    app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

fn create_main_window(app: &tauri::App) -> tauri::Result<()> {
    let handle = app.handle().clone();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("WipeClip")
        .inner_size(1440.0, 900.0)
        .min_inner_size(1024.0, 640.0)
        .center()
        // Leaves file drops to the page, so the editor's own drag-and-drop
        // import keeps working exactly as on the website.
        .disable_drag_drop_handler()
        // Keeps a screen recording running while the window is minimized:
        // WebKit (macOS 14+) otherwise suspends hidden pages after ~5 min.
        // Not supported (and not needed - pages capturing media aren't
        // frozen) on Windows.
        .background_throttling(BackgroundThrottlingPolicy::Disabled)
        // The window only ever shows the bundled app. Anything else (a
        // stray link, a redirect) opens in the system browser instead, so
        // a remote page can never end up in a window with app permissions.
        .on_navigation(move |url| {
            if links::is_app_url(url) {
                return true;
            }
            if let Err(err) = links::open_external_url(&handle, url.as_str()) {
                log::warn!("blocked navigation to {url}: {err}");
            }
            false
        })
        .build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // A second launch (e.g. from a wipeclip:// link on Windows) hands its
    // link to this instance - via the deep-link feature - and just focuses
    // the existing window. Registered first, as the plugin requires.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    let app = builder
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([Target::new(TargetKind::Stdout), Target::new(TargetKind::LogDir { file_name: None })])
                .max_file_size(5_000_000)
                .build(),
        )
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(export::ExportState::default())
        .manage(recording::RecordingState::default())
        .manage(input::InputState::default())
        .manage(capture::CaptureState::default())
        .manage(engine::EngineState::default())
        .manage(updater::UpdateState::default())
        .invoke_handler(tauri::generate_handler![
            engine::local_engine,
            desktop_capabilities,
            show_error,
            confirm_action,
            frontend_log,
            links::open_external,
            export::choose_export_path,
            export::write_export,
            export::reveal_export,
            export::save_text_file,
            secure_storage::secure_storage_get,
            secure_storage::secure_storage_set,
            secure_storage::secure_storage_remove,
            recorder_displays,
            capture::capture_support,
            capture::capture_sources,
            capture::capture_thumbnail,
            capture::capture_start,
            capture::capture_pause,
            capture::capture_status,
            capture::capture_stop,
            capture::capture_frame,
            capture::capture_exclude_window,
            capture::capture_preview,
            capture::capture_clock,
            recorder_mini,
            recorder_window,
            open_privacy_settings,
            open_notices,
            updater::update_check,
            updater::update_install,
            shortcuts::recorder_shortcuts,
            recording::recording_default_dir,
            recording::recording_choose_dir,
            recording::recording_storage,
            recording::recording_begin,
            recording::recording_append,
            recording::recording_write,
            recording::recording_finish,
            recording::recording_discard,
            recording::recording_read,
            recording::recording_open,
            recording::recording_scan_incomplete,
            recording::recording_update_manifest,
            recording::recording_reveal,
            input::input_permissions,
            input::input_request_access,
            input::input_start,
            input::input_now,
            input::input_drain,
            input::input_stop,
        ])
        .setup(|app| {
            log::info!("WipeClip {} starting", app.package_info().version);
            // Installed builds register wipeclip:// through the installer;
            // dev builds on Windows/Linux need it registered at runtime.
            #[cfg(all(debug_assertions, any(windows, target_os = "linux")))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(err) = app.deep_link().register_all() {
                    log::warn!("couldn't register wipeclip:// for dev: {err}");
                }
            }
            create_main_window(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building WipeClip");

    app.run(|handle, event| {
        // Quitting mid-recording: stop the input hooks and flush what was
        // recorded; the folder is offered for recovery on the next start.
        if let tauri::RunEvent::Exit = event {
            handle.state::<input::InputState>().shutdown();
            handle.state::<capture::CaptureState>().shutdown();
            handle.state::<recording::RecordingState>().close_all();
            handle.state::<engine::EngineState>().shutdown();
        }
    });
}
