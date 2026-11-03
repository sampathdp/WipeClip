//! Saving a finished export to a location the user picks.
//!
//! Two steps, so the (possibly large) video only crosses the IPC bridge once
//! the user has actually chosen where it goes:
//!  1. `choose_export_path` shows the OS save dialog (which also handles
//!     "file already exists - replace?") and returns an opaque one-time
//!     token for the chosen path. The frontend never names a path itself.
//!  2. `write_export` takes the token and the raw bytes, writes them to a
//!     temporary file beside the target, flushes it to disk, and renames it
//!     into place. A failure part-way removes the temporary file, so the
//!     chosen name never holds a truncated video.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::ipc::{InvokeBody, Request};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
pub struct ExportState {
    /// token -> chosen path, consumed by write_export.
    pending: Mutex<HashMap<String, PathBuf>>,
    /// Files this session wrote; the only ones reveal_export will show.
    saved: Mutex<HashSet<PathBuf>>,
    /// token -> folder chosen for a batch export (choose_export_folder).
    folders: Mutex<HashMap<String, PathBuf>>,
}

/// What is being saved: an exported video, a project file
/// (src/lib/editor/projectFile.ts), or an image tool's PNG result. Decides the dialog's title and filter
/// and the extension the file must end in.
struct SaveKind {
    title: &'static str,
    filter: &'static str,
    ext: &'static str,
    fallback: &'static str,
}

const VIDEO: SaveKind = SaveKind { title: "Save exported video", filter: "MP4 video", ext: "mp4", fallback: "wipeclip-export" };
const PROJECT: SaveKind = SaveKind { title: "Save project file", filter: "WipeClip project", ext: "wipeclip", fallback: "project" };
const IMAGE: SaveKind = SaveKind { title: "Save image", filter: "PNG image", ext: "png", fallback: "image" };

fn save_kind(kind: Option<&str>) -> Result<&'static SaveKind, String> {
    match kind.unwrap_or("video") {
        "video" => Ok(&VIDEO),
        "project" => Ok(&PROJECT),
        "image" => Ok(&IMAGE),
        _ => Err("Unknown file kind.".into()),
    }
}

/// Keeps the suggested name to a plain file name ending in the kind's extension.
fn clean_file_name(suggested: &str, kind: &SaveKind) -> String {
    let name: String = suggested
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .collect();
    let name = name.trim().trim_matches('.').to_string();
    let name = if name.is_empty() { format!("{}.{}", kind.fallback, kind.ext) } else { name };
    if name.to_ascii_lowercase().ends_with(&format!(".{}", kind.ext)) {
        name
    } else {
        format!("{name}.{}", kind.ext)
    }
}

#[tauri::command]
pub async fn choose_export_path(
    app: tauri::AppHandle,
    state: State<'_, ExportState>,
    media: State<'_, crate::media::MediaState>,
    recordings: State<'_, crate::recording::RecordingState>,
    suggested_name: String,
    kind: Option<String>,
) -> Result<Option<String>, String> {
    let kind = save_kind(kind.as_deref())?;
    let picked = app
        .dialog()
        .file()
        .set_title(kind.title)
        .set_file_name(clean_file_name(&suggested_name, kind))
        .add_filter(kind.filter, &[kind.ext])
        .blocking_save_file();
    let Some(picked) = picked else { return Ok(None) };
    let mut path = picked.into_path().map_err(|e| e.to_string())?;
    if path.extension().map(|e| !e.eq_ignore_ascii_case(kind.ext)).unwrap_or(true) {
        let mut name = path.file_name().unwrap_or_default().to_os_string();
        name.push(format!(".{}", kind.ext));
        path.set_file_name(name);
    }
    // The dialog's "replace?" is no reason to destroy an original recording.
    if crate::media::is_source(&app, &media, &recordings, &path) {
        return Err("That file is one of your source videos or recordings. Choose another name so the original stays as it is.".into());
    }
    let token = uuid::Uuid::new_v4().to_string();
    state.pending.lock().unwrap().insert(token.clone(), path);
    Ok(Some(token))
}

/// Batch exports (several highlights): the OS folder dialog once, then
/// `export_path_in` names each file in that folder. Returns an opaque token
/// for the folder; the page never names a folder itself.
#[tauri::command]
pub async fn choose_export_folder(app: tauri::AppHandle, state: State<'_, ExportState>) -> Result<Option<String>, String> {
    let picked = app.dialog().file().set_title("Choose a folder for the exported videos").blocking_pick_folder();
    let Some(picked) = picked else { return Ok(None) };
    let dir = picked.into_path().map_err(|e| e.to_string())?;
    if !dir.is_dir() {
        return Err("That folder no longer exists.".into());
    }
    let token = uuid::Uuid::new_v4().to_string();
    state.folders.lock().unwrap().insert(token.clone(), dir);
    Ok(Some(token))
}

/// A one-time `write_export` token for a new video file in a folder chosen
/// with `choose_export_folder`. Never replaces anything: an existing name
/// gets " (2)", " (3)"... appended.
#[tauri::command]
pub fn export_path_in(state: State<'_, ExportState>, folder: String, suggested_name: String) -> Result<String, String> {
    let dir = state.folders.lock().unwrap().get(&folder).cloned().ok_or("Choose the folder again.")?;
    let path = free_name(&dir, &clean_file_name(&suggested_name, &VIDEO), |p| p.exists()).ok_or("Too many files with that name in the folder.")?;
    let token = uuid::Uuid::new_v4().to_string();
    state.pending.lock().unwrap().insert(token.clone(), path);
    Ok(token)
}

/// `name` in `dir`, or "stem (n).ext" for the first n that doesn't exist.
fn free_name(dir: &Path, name: &str, exists: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    let first = dir.join(name);
    if !exists(&first) {
        return Some(first);
    }
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    (2..1000).map(|n| dir.join(if ext.is_empty() { format!("{stem} ({n})") } else { format!("{stem} ({n}).{ext}") })).find(|p| !exists(p))
}

#[tauri::command]
pub async fn write_export(request: Request<'_>, state: State<'_, ExportState>) -> Result<String, String> {
    let token = request
        .headers()
        .get("x-export-token")
        .and_then(|v| v.to_str().ok())
        .ok_or("Missing export token.")?;
    let path = state
        .pending
        .lock()
        .unwrap()
        .remove(token)
        .ok_or("That save location has expired. Choose it again.")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Export data was not sent as raw bytes.".into());
    };
    write_atomically(&path, bytes).map_err(|e| {
        log::error!("export save to {} failed: {e}", crate::media::log_name(&path));
        friendly_io_error(&e)
    })?;
    log::info!("export saved: {} ({} bytes)", crate::media::log_name(&path), bytes.len());
    state.saved.lock().unwrap().insert(path.clone());
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn reveal_export(app: tauri::AppHandle, state: State<'_, ExportState>, path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !state.saved.lock().unwrap().contains(&path) {
        return Err("Unknown file.".into());
    }
    app.opener().reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

/// Text exports the editor offers (captions, transcripts, chapter lists).
const TEXT_KINDS: [(&str, &str); 4] = [("srt", "SubRip subtitles"), ("vtt", "WebVTT"), ("txt", "Text"), ("json", "JSON")];

/// Plain file name with one of TEXT_KINDS as its extension, or None.
fn clean_text_name(suggested: &str) -> Option<(String, &'static str, &'static str)> {
    let name: String = suggested
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/|?*"#.contains(c) { '_' } else { c })
        .collect();
    let name = name.trim().trim_matches('.').to_string();
    let (_, ext) = name.rsplit_once('.')?;
    let ext = ext.to_ascii_lowercase();
    let &(kind, label) = TEXT_KINDS.iter().find(|(k, _)| *k == ext.as_str())?;
    Some((name, kind, label))
}

/// Saves a small text file (subtitles, chapters) where the user picks.
/// The page names the file, never a folder; the OS dialog asks before
/// replacing an existing file.
#[tauri::command]
pub async fn save_text_file(app: tauri::AppHandle, suggested_name: String, contents: String) -> Result<Option<String>, String> {
    if contents.len() > 20 * 1024 * 1024 {
        return Err("That file is too large.".into());
    }
    let (name, ext, label) = clean_text_name(&suggested_name).ok_or("Unsupported file type.")?;
    let picked = app
        .dialog()
        .file()
        .set_title("Save file")
        .set_file_name(&name)
        .add_filter(label, &[ext])
        .blocking_save_file();
    let Some(picked) = picked else { return Ok(None) };
    let mut path = picked.into_path().map_err(|e| e.to_string())?;
    if path.extension().map(|e| !e.eq_ignore_ascii_case(ext)).unwrap_or(true) {
        let mut n = path.file_name().unwrap_or_default().to_os_string();
        n.push(format!(".{ext}"));
        path.set_file_name(n);
    }
    write_atomically(&path, contents.as_bytes()).map_err(|e| friendly_io_error(&e))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Where the engine leaves finished exports (WIPECLIP_EXPORTS_DIR, see
/// engine.rs): a long video then never passes through the page's memory.
/// `save_rendered_export` copies one to where the user saves it, and the
/// page discards it when the export dialog closes; anything left over is
/// removed when the app starts.
pub(crate) fn rendered_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("exports"))
}

/// Leftovers from a previous run (the app quit before the dialog closed).
pub(crate) fn clear_rendered(app: &tauri::AppHandle) {
    let Some(dir) = rendered_dir(app) else { return };
    let Ok(entries) = fs::read_dir(&dir) else { return };
    for entry in entries.flatten() {
        let _ = fs::remove_file(entry.path());
    }
}

/// `path` if it's a file directly in rendered_dir; the page can't name any
/// other file.
fn rendered_file(app: &tauri::AppHandle, path: &str) -> Result<PathBuf, String> {
    let dir = rendered_dir(app).and_then(|d| fs::canonicalize(d).ok()).ok_or("Unknown file.")?;
    let file = fs::canonicalize(path).map_err(|_| "That export is no longer there. Export it again.".to_string())?;
    if file.parent() != Some(dir.as_path()) || !file.is_file() {
        return Err("Unknown file.".into());
    }
    Ok(file)
}

/// Lets the page play a finished export from the engine's folder.
#[tauri::command]
pub fn show_rendered_export(app: tauri::AppHandle, path: String) -> Result<(), String> {
    rendered_file(&app, &path)?;
    app.asset_protocol_scope().allow_file(&path).map_err(|e| e.to_string())
}

/// Copies a finished export to the location chosen with `choose_export_path`.
#[tauri::command]
pub async fn save_rendered_export(app: tauri::AppHandle, state: State<'_, ExportState>, token: String, path: String) -> Result<String, String> {
    let source = rendered_file(&app, &path)?;
    let target = state.pending.lock().unwrap().remove(&token).ok_or("That save location has expired. Choose it again.")?;
    let to = target.clone();
    let copied = tauri::async_runtime::spawn_blocking(move || copy_atomically(&to, &source))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| {
            log::error!("export save to {} failed: {e}", crate::media::log_name(&target));
            friendly_io_error(&e)
        })?;
    log::info!("export saved: {} ({copied} bytes)", crate::media::log_name(&target));
    state.saved.lock().unwrap().insert(target.clone());
    Ok(target.to_string_lossy().into_owned())
}

/// Deletes a finished export the page no longer needs.
#[tauri::command]
pub fn discard_rendered_export(app: tauri::AppHandle, path: String) {
    if let Ok(file) = rendered_file(&app, &path) {
        let _ = fs::remove_file(file);
    }
}

/// A temporary name beside `target`, for writing it atomically.
fn partial_path(target: &Path) -> io::Result<PathBuf> {
    let dir = target.parent().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no parent folder"))?;
    let name = target.file_name().unwrap_or_default().to_string_lossy();
    Ok(dir.join(format!(".{name}.{}.partial", uuid::Uuid::new_v4().simple())))
}

/// `write_atomically` for a file already on disk: copied beside the target,
/// flushed, then renamed into place.
pub(crate) fn copy_atomically(target: &Path, source: &Path) -> io::Result<u64> {
    let temp = partial_path(target)?;
    let result = (|| {
        let copied = fs::copy(source, &temp)?;
        fs::OpenOptions::new().write(true).open(&temp)?.sync_all()?;
        fs::rename(&temp, target)?;
        Ok(copied)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

pub(crate) fn write_atomically(target: &Path, bytes: &[u8]) -> io::Result<()> {
    let temp = partial_path(target)?;
    let result = (|| {
        let mut file = File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        // Replaces an existing file the user agreed to overwrite in the dialog.
        fs::rename(&temp, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

pub(crate) fn friendly_io_error(e: &io::Error) -> String {
    // ENOSPC on macOS/Linux; ERROR_HANDLE_DISK_FULL / ERROR_DISK_FULL on Windows.
    let disk_full = matches!(e.raw_os_error(), Some(28)) && !cfg!(windows)
        || cfg!(windows) && matches!(e.raw_os_error(), Some(39) | Some(112));
    if disk_full {
        return "There isn't enough free disk space there.".into();
    }
    match e.kind() {
        io::ErrorKind::PermissionDenied => "WipeClip isn't allowed to write to that folder.".into(),
        io::ErrorKind::NotFound => "That folder no longer exists.".into(),
        _ => format!("Couldn't save the file ({e})."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names() {
        assert_eq!(clean_file_name("wipeclip-clip-edit.mp4", &VIDEO), "wipeclip-clip-edit.mp4");
        assert_eq!(clean_file_name("a/b\\c:d", &VIDEO), "a_b_c_d.mp4");
        assert_eq!(clean_file_name("...", &VIDEO), "wipeclip-export.mp4");
        assert_eq!(clean_file_name("clip.MP4", &VIDEO), "clip.MP4");
        assert_eq!(clean_file_name("My trip", &PROJECT), "My trip.wipeclip");
        assert_eq!(clean_file_name("trip.mp4", &PROJECT), "trip.mp4.wipeclip");
        assert_eq!(clean_file_name("", &PROJECT), "project.wipeclip");
    }

    #[test]
    fn save_kinds() {
        assert_eq!(save_kind(None).unwrap().ext, "mp4");
        assert_eq!(save_kind(Some("project")).unwrap().ext, "wipeclip");
        assert_eq!(save_kind(Some("image")).unwrap().ext, "png");
        assert_eq!(clean_file_name("no-bg-cat", &IMAGE), "no-bg-cat.png");
        assert!(save_kind(Some("exe")).is_err());
    }

    #[test]
    fn text_names() {
        assert_eq!(clean_text_name("My video.srt").map(|n| n.1), Some("srt"));
        assert_eq!(clean_text_name("chapters.TXT").map(|n| n.1), Some("txt"));
        assert_eq!(clean_text_name("a/b.vtt").map(|n| n.0), Some("a_b.vtt".to_string()));
        assert!(clean_text_name("evil.exe").is_none());
        assert!(clean_text_name("noext").is_none());
    }

    #[test]
    fn batch_names_never_replace_a_file() {
        let dir = Path::new("out");
        let taken = [dir.join("clip.mp4"), dir.join("clip (2).mp4")];
        let exists = |p: &Path| taken.iter().any(|t| t == p);
        assert_eq!(free_name(dir, "new.mp4", exists), Some(dir.join("new.mp4")));
        assert_eq!(free_name(dir, "clip.mp4", exists), Some(dir.join("clip (3).mp4")));
        assert_eq!(free_name(dir, &clean_file_name("../../evil", &VIDEO), |_| false), Some(dir.join("_.._evil.mp4")));
    }

    #[test]
    fn atomic_write_replaces_and_cleans_up() {
        let dir = std::env::temp_dir().join(format!("wipeclip-test-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("out.mp4");
        fs::write(&target, b"old").unwrap();
        write_atomically(&target, b"new contents").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new contents");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1, "no temp file left behind");

        let missing = dir.join("missing-folder").join("out.mp4");
        assert!(write_atomically(&missing, b"x").is_err());

        let source = dir.join("rendered.mp4");
        fs::write(&source, b"rendered").unwrap();
        assert_eq!(copy_atomically(&target, &source).unwrap(), 8);
        assert_eq!(fs::read(&target).unwrap(), b"rendered");
        assert!(source.exists(), "the rendered file is left for the page to discard");
        assert!(copy_atomically(&missing, &source).is_err());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2, "no temp file left behind");
        fs::remove_dir_all(&dir).unwrap();
    }
}
