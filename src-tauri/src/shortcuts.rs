//! System-wide recorder hotkeys, so a recording can be controlled while
//! another app is in front. Registered only while the recorder is open and
//! released when it closes, so they don't block these key combinations in
//! other apps the rest of the time. A press is sent to the page as a
//! "recorder://shortcut" event carrying the action name.

use serde::Serialize;
use tauri::Emitter;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub const EVENT: &str = "recorder://shortcut";

/// (action, accelerator). CommandOrControl = Cmd on macOS, Ctrl elsewhere.
const SHORTCUTS: [(&str, &str); 4] = [
    ("toggle", "CommandOrControl+Alt+R"),
    ("pause", "CommandOrControl+Alt+P"),
    ("marker", "CommandOrControl+Alt+M"),
    ("screenshot", "CommandOrControl+Alt+S"),
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutStatus {
    action: &'static str,
    accelerator: &'static str,
    /// None = registered; otherwise why not (usually: another app owns it).
    error: Option<String>,
}

#[tauri::command]
pub fn recorder_shortcuts(app: tauri::AppHandle, enable: bool) -> Vec<ShortcutStatus> {
    let gs = app.global_shortcut();
    SHORTCUTS
        .iter()
        .map(|&(action, accelerator)| {
            let error = if enable {
                if gs.is_registered(accelerator) {
                    None
                } else {
                    gs.on_shortcut(accelerator, move |app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            let _ = app.emit(EVENT, action);
                        }
                    })
                    .err()
                    .map(|e| e.to_string())
                }
            } else {
                let _ = gs.unregister(accelerator);
                None
            };
            ShortcutStatus { action, accelerator, error }
        })
        .collect()
}
