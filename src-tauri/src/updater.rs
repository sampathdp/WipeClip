//! App updates from GitHub Releases (tauri-plugin-updater). Checked and
//! installed from Rust only; the page gets no updater plugin permissions,
//! just these two commands. Updates are signed with the key in
//! docs/desktop/RELEASE.md (Updates); the public key is in tauri.conf.json.

use serde::Serialize;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::Manager;
use tauri_plugin_updater::{Update, UpdaterExt};

/// The update found by the last check, kept for `update_install`.
#[derive(Default)]
pub struct UpdateState(Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct UpdateInfo {
    version: String,
    notes: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum UpdateProgress {
    #[serde(rename_all = "camelCase")]
    Progress { downloaded: u64, total: Option<u64> },
    Installing,
}

/// A newer version, or None. Debug builds never update.
#[tauri::command]
pub async fn update_check(app: tauri::AppHandle, state: tauri::State<'_, UpdateState>) -> Result<Option<UpdateInfo>, String> {
    if cfg!(debug_assertions) {
        return Ok(None);
    }
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let info = update.as_ref().map(|u| UpdateInfo { version: u.version.clone(), notes: u.body.clone() });
    if let Some(u) = &update {
        log::info!("update available: {} -> {}", u.current_version, u.version);
    }
    *state.0.lock().map_err(|e| e.to_string())? = update;
    Ok(info)
}

/// Downloads and installs the checked update, then restarts. On Windows the
/// installer closes the app itself. Refused while a recording is written,
/// so it can't be cut off.
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle, on_progress: Channel<UpdateProgress>) -> Result<(), String> {
    if app.state::<crate::recording::RecordingState>().is_recording() {
        return Err("Finish the recording first, then update.".into());
    }
    let update = app
        .state::<UpdateState>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("No update to install. Check again.")?;
    log::info!("installing update {}", update.version);
    let mut downloaded = 0u64;
    update
        .download_and_install(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = on_progress.send(UpdateProgress::Progress { downloaded, total });
            },
            || {
                let _ = on_progress.send(UpdateProgress::Installing);
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}
