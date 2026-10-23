//! OS notifications for long work that finishes while the user is in
//! another app (an export). Shown from Rust only; the page gets no
//! notification plugin permissions, just this command.

use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

fn clip(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// Shows a notification unless WipeClip's window is focused (the user
/// already sees the result there). Returns whether one was shown.
#[tauri::command]
pub fn notify_if_away(app: tauri::AppHandle, title: String, body: String) -> bool {
    let focused = app.get_webview_window("main").and_then(|w| w.is_focused().ok()).unwrap_or(false);
    if focused {
        return false;
    }
    match app.notification().builder().title(clip(&title, 80)).body(clip(&body, 200)).show() {
        Ok(()) => true,
        Err(e) => {
            log::warn!("notification failed: {e}");
            false
        }
    }
}
