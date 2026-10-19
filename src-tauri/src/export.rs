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
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
pub struct ExportState {
    /// token -> chosen path, consumed by write_export.
    pending: Mutex<HashMap<String, PathBuf>>,
    /// Files this session wrote; the only ones reveal_export will show.
    saved: Mutex<HashSet<PathBuf>>,
}

/// Keeps the suggested name to a plain file name ending in .mp4.
fn clean_file_name(suggested: &str) -> String {
    let name: String = suggested
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .collect();
    let name = name.trim().trim_matches('.').to_string();
    let name = if name.is_empty() { "wipeclip-export.mp4".to_string() } else { name };
    if name.to_ascii_lowercase().ends_with(".mp4") {
        name
    } else {
        format!("{name}.mp4")
    }
}

#[tauri::command]
pub async fn choose_export_path(
    app: tauri::AppHandle,
    state: State<'_, ExportState>,
    suggested_name: String,
) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Save exported video")
        .set_file_name(clean_file_name(&suggested_name))
        .add_filter("MP4 video", &["mp4"])
        .blocking_save_file();
    let Some(picked) = picked else { return Ok(None) };
    let mut path = picked.into_path().map_err(|e| e.to_string())?;
    if path.extension().map(|e| !e.eq_ignore_ascii_case("mp4")).unwrap_or(true) {
        let mut name = path.file_name().unwrap_or_default().to_os_string();
        name.push(".mp4");
        path.set_file_name(name);
    }
    let token = uuid::Uuid::new_v4().to_string();
    state.pending.lock().unwrap().insert(token.clone(), path);
    Ok(Some(token))
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
        log::error!("export save to {} failed: {e}", path.display());
        friendly_io_error(&e)
    })?;
    log::info!("export saved: {} ({} bytes)", path.display(), bytes.len());
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

pub(crate) fn write_atomically(target: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = target.parent().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no parent folder"))?;
    let name = target.file_name().unwrap_or_default().to_string_lossy();
    let temp = dir.join(format!(".{name}.{}.partial", uuid::Uuid::new_v4().simple()));
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
        assert_eq!(clean_file_name("wipeclip-clip-edit.mp4"), "wipeclip-clip-edit.mp4");
        assert_eq!(clean_file_name("a/b\\c:d"), "a_b_c_d.mp4");
        assert_eq!(clean_file_name("..."), "wipeclip-export.mp4");
        assert_eq!(clean_file_name("clip.MP4"), "clip.MP4");
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
        fs::remove_dir_all(&dir).unwrap();
    }
}
