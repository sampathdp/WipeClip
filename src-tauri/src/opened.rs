//! Project files the OS asks WipeClip to open: double-click or "Open with"
//! on a .wipeclip file (registered by `bundle.fileAssociations`).
//!
//! Windows/Linux pass the path on the command line - to a fresh launch, or
//! through the single-instance plugin to the app already running. macOS
//! sends `RunEvent::Opened`. Either way the path is queued here behind a
//! one-time token and the page is told (`EVENT`); the page then lists the
//! queue and reads each file by token. It never names a path itself, so it
//! can only read files the OS handed to the app.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{Emitter, Manager};

pub const EXT: &str = "wipeclip";
pub const EVENT: &str = "project-file-opened";
/// Read whole into memory for the page, so capped well below what a
/// WebView can hold. Larger files open through the in-app file picker,
/// which keeps them on disk.
const MAX_BYTES: u64 = 2 << 30;

#[derive(Default)]
pub struct OpenedState {
    pending: Mutex<Vec<(String, PathBuf)>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFile {
    token: String,
    name: String,
    size: u64,
}

fn is_project_file(path: &Path) -> bool {
    path.extension().map(|e| e.eq_ignore_ascii_case(EXT)).unwrap_or(false) && path.is_file()
}

/// Project file paths in a launch's arguments (argv[0], flags and
/// wipeclip:// links skipped), relative ones resolved against `cwd`.
pub fn paths_from_args(args: &[String], cwd: &Path) -> Vec<PathBuf> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-') && !a.contains("://"))
        .map(|a| {
            let p = PathBuf::from(a);
            if p.is_absolute() {
                p
            } else {
                cwd.join(p)
            }
        })
        .filter(|p| is_project_file(p))
        .collect()
}

/// Queues `paths` and tells the main window. Unsupported paths are ignored.
pub fn offer(app: &tauri::AppHandle, paths: Vec<PathBuf>) {
    let paths: Vec<PathBuf> = paths.into_iter().filter(|p| is_project_file(p)).collect();
    if paths.is_empty() {
        return;
    }
    {
        let state = app.state::<OpenedState>();
        let mut pending = state.pending.lock().unwrap();
        for p in paths {
            log::info!("project file to open: {}", crate::media::log_name(&p));
            pending.push((uuid::Uuid::new_v4().to_string(), p));
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = window.emit(EVENT, ());
    }
}

/// Files waiting to be opened, oldest first. Stays queued until read.
#[tauri::command]
pub fn opened_files(state: tauri::State<'_, OpenedState>) -> Vec<OpenedFile> {
    state
        .pending
        .lock()
        .unwrap()
        .iter()
        .map(|(token, path)| OpenedFile {
            token: token.clone(),
            name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            size: fs::metadata(path).map(|m| m.len()).unwrap_or(0),
        })
        .collect()
}

/// The file's bytes, taking it off the queue.
#[tauri::command]
pub async fn opened_file_read(state: tauri::State<'_, OpenedState>, token: String) -> Result<tauri::ipc::Response, String> {
    let path = {
        let mut pending = state.pending.lock().unwrap();
        let at = pending.iter().position(|(t, _)| *t == token).ok_or("That file was already opened.")?;
        pending.remove(at).1
    };
    let size = fs::metadata(&path).map_err(|_| "The project file can't be found any more.".to_string())?.len();
    if size > MAX_BYTES {
        return Err("This project file is too large to open by double-clicking. Open it with \"Open a project file\" on WipeClip's start screen.".into());
    }
    let bytes = fs::read(&path).map_err(|e| {
        log::error!("reading {} failed: {e}", crate::media::log_name(&path));
        "The project file couldn't be read.".to_string()
    })?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_project_files_from_args() {
        let dir = std::env::temp_dir().join(format!("wipeclip-opened-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.wipeclip"), b"x").unwrap();
        fs::write(dir.join("b.WIPECLIP"), b"x").unwrap();
        fs::write(dir.join("c.mp4"), b"x").unwrap();
        let args: Vec<String> = vec![
            "WipeClip.exe".into(),
            "--flag".into(),
            "wipeclip://auth/callback?code=1".into(),
            dir.join("a.wipeclip").to_string_lossy().into_owned(),
            "b.WIPECLIP".into(),
            "c.mp4".into(),
            "missing.wipeclip".into(),
        ];
        let found = paths_from_args(&args, &dir);
        assert_eq!(found, vec![dir.join("a.wipeclip"), dir.join("b.WIPECLIP")]);
        fs::remove_dir_all(&dir).unwrap();
    }
}
