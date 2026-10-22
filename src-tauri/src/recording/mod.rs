//! Screen recordings on disk. The page captures with the WebView's media
//! APIs and streams each track here in ~1 s chunks; this module owns the
//! files (format: src/lib/recorder/format.ts).
//!
//! - A recording is a new folder inside a location the user picked (or the
//!   default Videos/WipeClip). Folder names are never reused, so nothing
//!   existing is ever overwritten.
//! - Chunks are appended as they arrive and synced to disk regularly, so a
//!   crash or power loss leaves at most the last seconds unwritten. The
//!   manifest is written first with status "recording" and rewritten when
//!   the recording is finalized; leftovers are found by
//!   recording_scan_incomplete on the next start.
//! - The page never names arbitrary paths: it gets an opaque session id for
//!   writing, and may only read, reveal or delete folders this module
//!   created or the user picked in a dialog. File names inside a folder are
//!   checked by paths::valid_file_name.

pub mod paths;

use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::export::{friendly_io_error, write_atomically};

const MANIFEST: &str = "recording.json";
/// Sync appended media to disk every N chunks (~N seconds).
const SYNC_EVERY: u32 = 5;
/// Largest file recording_read hands to the page (the editor's own limit
/// is lower; this just stops a runaway allocation).
const MAX_READ_BYTES: u64 = 2 * 1024 * 1024 * 1024;

struct Session {
    dir: PathBuf,
    files: HashMap<String, File>,
    writes: u32,
}

#[derive(Default)]
pub struct RecordingState {
    /// Locations recordings may be created in.
    roots: Mutex<HashSet<PathBuf>>,
    /// Recording folders the page may read and reveal.
    known: Mutex<HashSet<PathBuf>>,
    /// Recording folders the page may delete (made this session, or an
    /// interrupted recording found by a scan).
    deletable: Mutex<HashSet<PathBuf>>,
    sessions: Mutex<HashMap<String, Session>>,
}

impl RecordingState {
    /// Folder of a running recording, for the native capture to write its
    /// tracks into.
    pub fn session_dir(&self, id: &str) -> Option<PathBuf> {
        self.sessions.lock().ok()?.get(id).map(|s| s.dir.clone())
    }

    /// A recording is being written (started and not yet finished).
    pub fn is_recording(&self) -> bool {
        self.sessions.lock().map(|s| !s.is_empty()).unwrap_or(true)
    }

    /// Flushes every open recording, e.g. when the app quits mid-recording;
    /// the folders stay behind as interrupted recordings to recover.
    pub fn close_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, s) in sessions.drain() {
                for (_, f) in s.files {
                    let _ = f.sync_all();
                }
            }
        }
    }
}

fn lock<T>(m: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, String> {
    m.lock().map_err(|_| "recording state poisoned".to_string())
}

fn header<'a>(request: &'a Request<'_>, name: &str) -> Result<&'a str, String> {
    request
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| format!("Missing {name}."))
}

fn checked_file(name: &str) -> Result<&str, String> {
    if paths::valid_file_name(name) {
        Ok(name)
    } else {
        Err("Invalid recording file name.".into())
    }
}

fn is_listed(set: &Mutex<HashSet<PathBuf>>, path: &Path) -> Result<bool, String> {
    Ok(lock(set)?.contains(path))
}

/// Where the user's chosen save folder is remembered between runs. Only
/// this side writes it, and only with a folder picked in the OS dialog, so
/// the page still can't make the app write anywhere it names.
fn saved_dir_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("recorder.json"))
}

fn load_saved_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let text = fs::read_to_string(saved_dir_file(app)?).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let dir = PathBuf::from(v.get("saveDir")?.as_str()?);
    // A removed folder (or unplugged drive) falls back to the default.
    dir.is_dir().then_some(dir)
}

fn store_saved_dir(app: &tauri::AppHandle, dir: &Path) {
    let Some(file) = saved_dir_file(app) else { return };
    if let Some(parent) = file.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let body = serde_json::json!({ "saveDir": dir.to_string_lossy() }).to_string();
    if let Err(e) = write_atomically(&file, body.as_bytes()) {
        log::warn!("couldn't remember the recording folder: {e}");
    }
}

/// The folder recordings go to: the one the user last picked (if it still
/// exists), else Videos/WipeClip (falling back to Documents, then home).
#[tauri::command]
pub fn recording_default_dir(app: tauri::AppHandle, state: State<'_, RecordingState>) -> Result<String, String> {
    if let Some(dir) = load_saved_dir(&app) {
        lock(&state.roots)?.insert(dir.clone());
        return Ok(dir.to_string_lossy().into_owned());
    }
    let paths = app.path();
    let base = paths
        .video_dir()
        .or_else(|_| paths.document_dir())
        .or_else(|_| paths.home_dir())
        .map_err(|e| e.to_string())?;
    let dir = base.join("WipeClip");
    lock(&state.roots)?.insert(dir.clone());
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn recording_choose_dir(app: tauri::AppHandle, state: State<'_, RecordingState>) -> Result<Option<String>, String> {
    let picked = app.dialog().file().set_title("Save recordings in").blocking_pick_folder();
    let Some(picked) = picked else { return Ok(None) };
    let dir = picked.into_path().map_err(|e| e.to_string())?;
    lock(&state.roots)?.insert(dir.clone());
    store_saved_dir(&app, &dir);
    Ok(Some(dir.to_string_lossy().into_owned()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Storage {
    free_bytes: Option<u64>,
}

/// Free space where recordings go (the nearest existing folder if the
/// location doesn't exist yet).
#[tauri::command]
pub async fn recording_storage(state: State<'_, RecordingState>, dir: String) -> Result<Storage, String> {
    let dir = PathBuf::from(dir);
    if !is_listed(&state.roots, &dir)? {
        return Err("Unknown recording location.".into());
    }
    let existing = dir.ancestors().find(|p| p.is_dir());
    let free_bytes = existing.and_then(|p| crate::input::available_space(p).ok());
    Ok(Storage { free_bytes })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Begun {
    id: String,
    path: String,
}

#[tauri::command]
pub async fn recording_begin(
    state: State<'_, RecordingState>,
    dir: String,
    folder_name: String,
    manifest: String,
) -> Result<Begun, String> {
    let root = PathBuf::from(dir);
    if !is_listed(&state.roots, &root)? {
        return Err("Unknown recording location.".into());
    }
    fs::create_dir_all(&root).map_err(|e| friendly_io_error(&e))?;
    let name = paths::sanitize_folder_name(&folder_name, "WipeClip Recording");
    let folder = paths::unique_child(&root, &name, |p| p.exists()).ok_or("Couldn't pick a free folder name.")?;
    // create_dir (not _all) fails if the folder appeared meanwhile.
    fs::create_dir(&folder).map_err(|e| friendly_io_error(&e))?;
    if let Err(e) = write_atomically(&folder.join(MANIFEST), manifest.as_bytes()) {
        let _ = fs::remove_dir_all(&folder);
        return Err(friendly_io_error(&e));
    }
    let id = uuid::Uuid::new_v4().to_string();
    lock(&state.known)?.insert(folder.clone());
    lock(&state.deletable)?.insert(folder.clone());
    lock(&state.sessions)?.insert(id.clone(), Session { dir: folder.clone(), files: HashMap::new(), writes: 0 });
    log::info!("recording started");
    Ok(Begun { id, path: folder.to_string_lossy().into_owned() })
}

fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        _ => Err("Recording data was not sent as raw bytes.".into()),
    }
}

/// Appends a chunk to one of the recording's files.
#[tauri::command]
pub async fn recording_append(request: Request<'_>, state: State<'_, RecordingState>) -> Result<(), String> {
    let id = header(&request, "x-recording")?;
    let name = checked_file(header(&request, "x-file")?)?;
    let bytes = raw_body(&request)?;
    let mut sessions = lock(&state.sessions)?;
    let session = sessions.get_mut(id).ok_or("This recording has already ended.")?;
    if !session.files.contains_key(name) {
        let f = OpenOptions::new()
            .create(true)
            .append(true)
            .open(session.dir.join(name))
            .map_err(|e| friendly_io_error(&e))?;
        session.files.insert(name.to_string(), f);
    }
    let file = session.files.get_mut(name).unwrap();
    file.write_all(bytes).map_err(|e| friendly_io_error(&e))?;
    session.writes += 1;
    if session.writes % SYNC_EVERY == 0 {
        for f in session.files.values() {
            let _ = f.sync_data();
        }
    }
    Ok(())
}

/// Writes a whole file (manifest updates, screenshots) atomically.
#[tauri::command]
pub async fn recording_write(request: Request<'_>, state: State<'_, RecordingState>) -> Result<(), String> {
    let id = header(&request, "x-recording")?;
    let name = checked_file(header(&request, "x-file")?)?;
    let bytes = raw_body(&request)?;
    let dir = lock(&state.sessions)?.get(id).map(|s| s.dir.clone()).ok_or("This recording has already ended.")?;
    let target = dir.join(name);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| friendly_io_error(&e))?;
    }
    write_atomically(&target, bytes).map_err(|e| friendly_io_error(&e))
}

/// Closes the recording's files and writes the final manifest.
#[tauri::command]
pub async fn recording_finish(state: State<'_, RecordingState>, id: String, manifest: String) -> Result<String, String> {
    let session = lock(&state.sessions)?.remove(&id).ok_or("This recording has already ended.")?;
    let mut first_error = None;
    for (_, f) in session.files {
        if let Err(e) = f.sync_all() {
            first_error.get_or_insert(e);
        }
    }
    if let Some(e) = first_error {
        return Err(friendly_io_error(&e));
    }
    write_atomically(&session.dir.join(MANIFEST), manifest.as_bytes()).map_err(|e| friendly_io_error(&e))?;
    log::info!("recording finished");
    Ok(session.dir.to_string_lossy().into_owned())
}

/// Deletes a recording folder this app created (Retake, Cancel, or
/// discarding an interrupted recording).
#[tauri::command]
pub async fn recording_discard(state: State<'_, RecordingState>, path: String) -> Result<(), String> {
    let dir = PathBuf::from(path);
    if !is_listed(&state.deletable, &dir)? {
        return Err("WipeClip only deletes recordings it made.".into());
    }
    lock(&state.sessions)?.retain(|_, s| s.dir != dir);
    // Only ever a folder holding a WipeClip manifest.
    if !dir.join(MANIFEST).is_file() {
        return Err("That folder isn't a WipeClip recording.".into());
    }
    fs::remove_dir_all(&dir).map_err(|e| friendly_io_error(&e))?;
    lock(&state.deletable)?.remove(&dir);
    lock(&state.known)?.remove(&dir);
    log::info!("recording discarded");
    Ok(())
}

/// One file of a finished recording, as raw bytes (for preview and for
/// opening it in the editor).
#[tauri::command]
pub async fn recording_read(state: State<'_, RecordingState>, path: String, file: String) -> Result<Response, String> {
    let dir = PathBuf::from(path);
    if !is_listed(&state.known, &dir)? {
        return Err("Unknown recording.".into());
    }
    let target = dir.join(checked_file(&file)?);
    let size = fs::metadata(&target).map_err(|e| friendly_io_error(&e))?.len();
    if size > MAX_READ_BYTES {
        return Err("This file is too large to open.".into());
    }
    let bytes = fs::read(&target).map_err(|e| friendly_io_error(&e))?;
    Ok(Response::new(bytes))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundRecording {
    path: String,
    manifest: String,
    /// Sizes of the files in the folder, by name, so an interrupted
    /// recording's tracks can be checked without reading them.
    sizes: HashMap<String, u64>,
}

fn describe(dir: &Path) -> Option<FoundRecording> {
    let manifest = fs::read_to_string(dir.join(MANIFEST)).ok()?;
    let mut sizes = HashMap::new();
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() && paths::valid_file_name(&name) {
                sizes.insert(name, meta.len());
            }
        }
    }
    Some(FoundRecording { path: dir.to_string_lossy().into_owned(), manifest, sizes })
}

/// Lets the user pick a recording (its recording.json) to open.
#[tauri::command]
pub async fn recording_open(app: tauri::AppHandle, state: State<'_, RecordingState>) -> Result<Option<FoundRecording>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Open a WipeClip recording")
        .add_filter("WipeClip recording", &["json"])
        .blocking_pick_file();
    let Some(picked) = picked else { return Ok(None) };
    let file = picked.into_path().map_err(|e| e.to_string())?;
    let dir = file.parent().ok_or("Invalid recording location.")?.to_path_buf();
    let found = describe(&dir).ok_or("That folder doesn't contain a WipeClip recording.")?;
    lock(&state.known)?.insert(dir);
    Ok(Some(found))
}

/// Recordings in `dir` whose manifest still says "recording": the app
/// closed or crashed before they were finalized.
#[tauri::command]
pub async fn recording_scan_incomplete(state: State<'_, RecordingState>, dir: String) -> Result<Vec<FoundRecording>, String> {
    let root = PathBuf::from(dir);
    if !is_listed(&state.roots, &root)? {
        return Err("Unknown recording location.".into());
    }
    let active: HashSet<PathBuf> = lock(&state.sessions)?.values().map(|s| s.dir.clone()).collect();
    let Ok(entries) = fs::read_dir(&root) else { return Ok(Vec::new()) };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() || active.contains(&dir) {
            continue;
        }
        let Some(rec) = describe(&dir) else { continue };
        let status = serde_json::from_str::<serde_json::Value>(&rec.manifest)
            .ok()
            .and_then(|v| v.get("status").and_then(|s| s.as_str()).map(str::to_owned));
        if status.as_deref() == Some("recording") {
            lock(&state.known)?.insert(dir.clone());
            lock(&state.deletable)?.insert(dir);
            found.push(rec);
        }
    }
    Ok(found)
}

/// Rewrites the manifest of a known, finished recording (marking a
/// recovered recording as such).
#[tauri::command]
pub async fn recording_update_manifest(state: State<'_, RecordingState>, path: String, manifest: String) -> Result<(), String> {
    let dir = PathBuf::from(path);
    if !is_listed(&state.known, &dir)? || !dir.join(MANIFEST).is_file() {
        return Err("Unknown recording.".into());
    }
    if lock(&state.sessions)?.values().any(|s| s.dir == dir) {
        return Err("This recording is still running.".into());
    }
    write_atomically(&dir.join(MANIFEST), manifest.as_bytes()).map_err(|e| friendly_io_error(&e))
}

#[tauri::command]
pub fn recording_reveal(app: tauri::AppHandle, state: State<'_, RecordingState>, path: String) -> Result<(), String> {
    let dir = PathBuf::from(path);
    if !is_listed(&state.known, &dir)? {
        return Err("Unknown recording.".into());
    }
    app.opener().reveal_item_in_dir(dir.join(MANIFEST)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn describe_lists_only_recording_files() {
        let dir = std::env::temp_dir().join(format!("wipeclip-rec-test-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&dir).unwrap();
        assert!(describe(&dir).is_none(), "no manifest, not a recording");
        fs::write(dir.join(MANIFEST), br#"{"status":"recording"}"#).unwrap();
        fs::write(dir.join("screen.mp4"), b"1234").unwrap();
        fs::write(dir.join("notes.txt"), b"x").unwrap();
        let found = describe(&dir).unwrap();
        assert_eq!(found.sizes.get("screen.mp4"), Some(&4));
        assert!(!found.sizes.contains_key("notes.txt"));
        fs::remove_dir_all(&dir).unwrap();
    }
}
