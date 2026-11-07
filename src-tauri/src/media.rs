//! Videos that stay where they are on disk. The editor plays them through
//! Tauri's asset protocol (streamed with range requests, never loaded into
//! memory), the local engine reads them by path, and saved projects keep
//! the path instead of a copy.
//!
//! The page can only stream files the user approved here: picked in the
//! OS dialog (`media_choose`), or a recording's media in a recording folder
//! this session knows. Approved paths are remembered between runs (in the
//! app's config folder, written only by this side), so reopening a project
//! doesn't ask again; `media_open` then adds them to the asset scope.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Video files the editor opens (same list as the engine's _VIDEO_SUFFIXES).
const VIDEO_EXTS: [&str; 6] = ["mp4", "mov", "m4v", "webm", "mkv", "avi"];
/// Media a recording folder holds.
const RECORDING_EXTS: [&str; 6] = ["mp4", "webm", "m4a", "aac", "ogg", "wav"];

#[derive(Default)]
pub struct MediaState {
    approved: Mutex<Option<HashSet<PathBuf>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFile {
    path: String,
    name: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaStatus {
    path: String,
    /// Exists and may be played.
    ok: bool,
    size: u64,
}

fn approved_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("media.json"))
}

fn has_ext(path: &Path, exts: &[&str]) -> bool {
    path.extension().and_then(|e| e.to_str()).map(|e| exts.iter().any(|x| e.eq_ignore_ascii_case(x))).unwrap_or(false)
}

fn with_approved<T>(app: &tauri::AppHandle, state: &MediaState, f: impl FnOnce(&mut HashSet<PathBuf>) -> T) -> T {
    let mut guard = state.approved.lock().unwrap();
    let set = guard.get_or_insert_with(|| {
        approved_file(app)
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str::<Vec<PathBuf>>(&s).ok())
            .map(|v| v.into_iter().collect())
            .unwrap_or_default()
    });
    f(set)
}

/// Remembers `path` as approved and lets the page stream it.
fn approve(app: &tauri::AppHandle, state: &MediaState, path: &Path) -> Result<(), String> {
    let added = with_approved(app, state, |set| set.insert(path.to_path_buf()).then(|| set.iter().cloned().collect::<Vec<_>>()));
    if let (Some(list), Some(file)) = (added, approved_file(app)) {
        if let Some(dir) = file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Err(e) = fs::write(&file, serde_json::to_string(&list).unwrap_or_default()) {
            log::warn!("couldn't remember approved media: {e}");
        }
    }
    app.asset_protocol_scope().allow_file(path).map_err(|e| e.to_string())
}

/// Whether `path` is an existing file the editor uses as a source: a video
/// approved here, or a track in a known recording folder. Saving over one
/// would replace the original recording, so export.rs refuses it. Compared
/// after resolving both sides, so another spelling of the same file (case,
/// `..`, short names) is caught too.
pub(crate) fn is_source(app: &tauri::AppHandle, state: &MediaState, recordings: &crate::recording::RecordingState, path: &Path) -> bool {
    let Ok(target) = fs::canonicalize(path) else { return false };
    if has_ext(&target, &RECORDING_EXTS)
        && [path.parent(), target.parent()].into_iter().flatten().any(|d| recordings.is_known_folder(d))
    {
        return true;
    }
    with_approved(app, state, |set| set.iter().any(|p| fs::canonicalize(p).is_ok_and(|p| p == target)))
}

/// How a file appears in the log: its extension only, never its name or
/// folder (redact.rs catches whatever else slips through).
pub(crate) fn log_name(path: &Path) -> String {
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => format!("a .{} file", ext.to_ascii_lowercase()),
        None => "a file".into(),
    }
}

fn describe(path: &Path) -> Result<MediaFile, String> {
    let meta = fs::metadata(path).map_err(|_| "That file can't be read.".to_string())?;
    Ok(MediaFile {
        path: path.to_string_lossy().into_owned(),
        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        size: meta.len(),
    })
}

/// The OS open dialog for a video to edit in place. `locate`: the name of a
/// project's video that went missing, for the dialog's title.
#[tauri::command]
pub async fn media_choose(app: tauri::AppHandle, state: State<'_, MediaState>, locate: Option<String>) -> Result<Option<MediaFile>, String> {
    let title = match &locate {
        Some(name) => format!("Find \"{name}\""),
        None => "Open a video".to_string(),
    };
    let picked = app.dialog().file().set_title(title).add_filter("Video", &VIDEO_EXTS).blocking_pick_file();
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    if !has_ext(&path, &VIDEO_EXTS) || !path.is_file() {
        return Err("Please choose a video file (MP4, MOV or WebM).".into());
    }
    approve(&app, &state, &path)?;
    log::info!("media picked: {}", log_name(&path));
    describe(&path).map(Some)
}

/// Makes these paths playable, for opening a project or a recording. A
/// path is ok when it exists and was approved before, or is media in a
/// recording folder this session knows (then it's approved now).
#[tauri::command]
pub fn media_open(
    app: tauri::AppHandle,
    state: State<'_, MediaState>,
    recordings: State<'_, crate::recording::RecordingState>,
    paths: Vec<String>,
) -> Vec<MediaStatus> {
    paths
        .into_iter()
        .map(|raw| {
            let path = PathBuf::from(&raw);
            let known = with_approved(&app, &state, |set| set.contains(&path))
                || (has_ext(&path, &RECORDING_EXTS) && path.parent().is_some_and(|d| recordings.is_known_folder(d)));
            let size = fs::metadata(&path).ok().filter(|m| m.is_file()).map(|m| m.len());
            let ok = match size {
                Some(_) if known => approve(&app, &state, &path).map_err(|e| log::warn!("media scope: {e}")).is_ok(),
                _ => false,
            };
            MediaStatus { path: raw, ok, size: size.unwrap_or(0) }
        })
        .collect()
}

/// The engine's cache of matted webcam videos (backend/app/pipeline/
/// matte.py), in the app's local data folder (engine.rs passes it on).
pub(crate) const MATTE_DIR: &str = "matte-cache";

/// Whether `path` is a matted video the engine made: an .mp4 directly in
/// the matte cache, compared after resolving both sides.
fn in_matte_dir(dir: &Path, path: &Path) -> bool {
    let (Ok(dir), Ok(file)) = (fs::canonicalize(dir), fs::canonicalize(path)) else { return false };
    file.parent() == Some(dir.as_path()) && has_ext(&file, &["mp4"]) && file.is_file()
}

/// Lets the editor play a matted webcam video (webcam background removal).
/// Only files the engine wrote to its matte cache are allowed - not
/// remembered, since they're a cache made again when missing.
#[tauri::command]
pub fn matte_open(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join(MATTE_DIR);
    let path = PathBuf::from(path);
    if !in_matte_dir(&dir, &path) {
        return Err("That file isn't a background removal video.".into());
    }
    app.asset_protocol_scope().allow_file(&path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extensions() {
        assert!(has_ext(Path::new("C:/a/clip.MOV"), &VIDEO_EXTS));
        assert!(!has_ext(Path::new("C:/a/clip.exe"), &VIDEO_EXTS));
        assert!(!has_ext(Path::new("C:/a/clip"), &VIDEO_EXTS));
        assert!(has_ext(Path::new("C:/rec/mic.m4a"), &RECORDING_EXTS));
    }

    #[test]
    fn matte_files_only_from_the_cache() {
        let root = std::env::temp_dir().join(format!("wipeclip-matte-test-{}", std::process::id()));
        let cache = root.join(MATTE_DIR);
        fs::create_dir_all(cache.join("sub")).unwrap();
        fs::write(cache.join("a.mp4"), b"x").unwrap();
        fs::write(cache.join("a.exe"), b"x").unwrap();
        fs::write(cache.join("sub").join("b.mp4"), b"x").unwrap();
        fs::write(root.join("c.mp4"), b"x").unwrap();
        assert!(in_matte_dir(&cache, &cache.join("a.mp4")));
        assert!(!in_matte_dir(&cache, &cache.join("a.exe")));
        assert!(!in_matte_dir(&cache, &cache.join("sub").join("b.mp4")));
        assert!(!in_matte_dir(&cache, &root.join("c.mp4")));
        assert!(!in_matte_dir(&cache, &cache.join("..").join("c.mp4")));
        assert!(!in_matte_dir(&cache, &cache.join("missing.mp4")));
        let _ = fs::remove_dir_all(&root);
    }
}
