//! File and folder names for recordings. No dependencies on the rest of the
//! crate, so it can be unit-tested on its own:
//! `rustc --edition 2021 --test src/recording/paths.rs`.

use std::path::{Path, PathBuf};

const MAX_NAME_CHARS: usize = 120;

/// A single folder name that is valid on Windows and macOS: no path
/// separators or reserved characters, no trailing dots/spaces, not a
/// reserved device name (CON, NUL, COM1...).
pub fn sanitize_folder_name(name: &str, fallback: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .take(MAX_NAME_CHARS)
        .collect();
    let cleaned = cleaned.trim().trim_end_matches(['.', ' ']).trim_start_matches('.').to_string();
    if cleaned.is_empty() {
        return fallback.to_string();
    }
    let stem = cleaned.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit());
    if reserved {
        format!("_{cleaned}")
    } else {
        cleaned
    }
}

/// `parent/base`, or `parent/base (2)`, `(3)`... - the first that doesn't
/// exist. Never returns an existing path, so a new recording can't
/// overwrite an old one.
pub fn unique_child(parent: &Path, base: &str, exists: impl Fn(&Path) -> bool) -> Option<PathBuf> {
    let first = parent.join(base);
    if !exists(&first) {
        return Some(first);
    }
    (2..10_000).map(|n| parent.join(format!("{base} ({n})"))).find(|p| !exists(p))
}

const MEDIA_EXTENSIONS: [&str; 7] = ["mp4", "webm", "m4a", "ogg", "jsonl", "json", "png"];

/// Files the page may write inside a recording folder: lowercase
/// `name.ext` with a known extension, or `screenshots/name.png`. Anything
/// else (separators, "..", absolute paths, odd extensions) is refused.
pub fn valid_file_name(name: &str) -> bool {
    let (dir, file) = match name.split_once('/') {
        Some(("screenshots", file)) => (true, file),
        Some(_) => return false,
        None => (false, name),
    };
    let Some((stem, ext)) = file.rsplit_once('.') else { return false };
    if dir && ext != "png" {
        return false;
    }
    !stem.is_empty()
        && stem.len() <= 64
        && stem.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !stem.starts_with('-')
        && MEDIA_EXTENSIONS.contains(&ext)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn folder_names() {
        assert_eq!(sanitize_folder_name("WipeClip Recording 2026-10-11 at 14.03.22", "x"), "WipeClip Recording 2026-10-11 at 14.03.22");
        assert_eq!(sanitize_folder_name("a/b\\c:d*?", "x"), "a_b_c_d__");
        assert_eq!(sanitize_folder_name("  ..  ", "fallback"), "fallback");
        assert_eq!(sanitize_folder_name("trailing. ", "x"), "trailing");
        assert_eq!(sanitize_folder_name("CON", "x"), "_CON");
        assert_eq!(sanitize_folder_name("com1.txt", "x"), "_com1.txt");
        assert_eq!(sanitize_folder_name("COMPUTER", "x"), "COMPUTER");
        assert_eq!(sanitize_folder_name(&"x".repeat(500), "f").len(), 120);
    }

    #[test]
    fn unique_children_never_reuse_a_name() {
        let taken: HashSet<PathBuf> = ["/r/A", "/r/A (2)"].iter().map(PathBuf::from).collect();
        let exists = |p: &Path| taken.contains(p);
        assert_eq!(unique_child(Path::new("/r"), "A", exists), Some(PathBuf::from("/r/A (3)")));
        assert_eq!(unique_child(Path::new("/r"), "B", exists), Some(PathBuf::from("/r/B")));
    }

    #[test]
    fn file_names() {
        for ok in ["screen.mp4", "system-audio.m4a", "microphone.webm", "events.jsonl", "recording.json", "screenshots/shot-001.png"] {
            assert!(valid_file_name(ok), "{ok}");
        }
        for bad in [
            "../x.mp4",
            "screenshots/../x.png",
            "screenshots/a.mp4",
            "other/a.png",
            "C:\\x.mp4",
            "/etc/x.json",
            "Screen.mp4",
            "screen.exe",
            "screen",
            ".mp4",
            "-a.mp4",
            "a b.mp4",
        ] {
            assert!(!valid_file_name(bad), "{bad}");
        }
    }
}
