//! Keeps personal details out of the log file users send us: every line
//! (the app's own, the engine's forwarded output, frontend errors) goes
//! through `redact` in the log formatter (lib.rs), so a file path that
//! slips into a message - an ffmpeg error naming its input, a Python
//! traceback from the installed engine - never shows the user name or the
//! file's name. Only the extension is kept, which is what a bug report
//! needs.

use std::borrow::Cow;

/// `text` with every absolute file path replaced by `<.ext file>` (or
/// `<path>` without an extension). Recognized: `C:\…`, `C:/…`, `\\server\…`
/// and the macOS/Linux home and temp roots. A path runs until a quote, a
/// line break, a character Windows forbids in names, or ": " (how ffmpeg
/// and Python follow a path with their message), so names with spaces are
/// caught whole.
pub fn redact(text: &str) -> Cow<'_, str> {
    let bytes = text.as_bytes();
    let mut out: Option<String> = None;
    let mut copied = 0;
    let mut i = 0;
    while i < bytes.len() {
        let Some(start_len) = path_start(text, i) else {
            i += 1;
            continue;
        };
        let end = path_end(bytes, i + start_len);
        // Sentence punctuation right after a path belongs to the sentence.
        let mut body_end = end;
        while body_end > i && matches!(bytes[body_end - 1], b'.' | b',' | b';' | b')' | b']') {
            body_end -= 1;
        }
        let o = out.get_or_insert_with(|| String::with_capacity(text.len()));
        o.push_str(&text[copied..i]);
        o.push_str(&placeholder(&text[i..body_end]));
        copied = body_end;
        i = end.max(i + 1);
    }
    match out {
        Some(mut o) => {
            o.push_str(&text[copied..]);
            Cow::Owned(o)
        }
        None => Cow::Borrowed(text),
    }
}

/// Length of the path prefix starting at `i`, if a path starts there.
fn path_start(text: &str, i: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    let prev_ok = i == 0 || !(bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'\\' || bytes[i - 1] == b'/');
    if !prev_ok {
        return None;
    }
    // C:\ C:/ (and C:\\ in an escaped string)
    if bytes.len() > i + 2 && bytes[i].is_ascii_alphabetic() && bytes[i + 1] == b':' && matches!(bytes[i + 2], b'\\' | b'/') {
        return Some(3);
    }
    // \\server\share
    if bytes.len() > i + 2 && bytes[i] == b'\\' && bytes[i + 1] == b'\\' && bytes[i + 2].is_ascii_alphanumeric() {
        return Some(2);
    }
    ["/Users/", "/home/", "/private/var/", "/var/folders/", "/tmp/"]
        .iter()
        .find(|root| text[i..].starts_with(*root))
        .map(|root| root.len())
}

fn path_end(bytes: &[u8], mut j: usize) -> usize {
    while j < bytes.len() {
        let b = bytes[j];
        if matches!(b, b'"' | b'\'' | b'\n' | b'\r' | b'\t' | b'<' | b'>' | b'|' | b'*' | b'?') {
            break;
        }
        if b == b':' && bytes.get(j + 1) == Some(&b' ') {
            break;
        }
        // "…\clip.mp4 (12 bytes)": a space right after a file extension
        // ends the path; other spaces are part of a name.
        if b == b' ' && ends_with_extension(&bytes[..j]) {
            break;
        }
        j += 1;
    }
    j
}

fn ends_with_extension(before: &[u8]) -> bool {
    let name = before.rsplit(|&c| c == b'\\' || c == b'/').next().unwrap_or(&[]);
    match name.iter().rposition(|&c| c == b'.') {
        Some(dot) if dot > 0 => {
            let ext = &name[dot + 1..];
            (1..=5).contains(&ext.len()) && ext.iter().all(u8::is_ascii_alphanumeric)
        }
        _ => false,
    }
}

fn placeholder(path: &str) -> String {
    let name = path.rsplit(['\\', '/']).next().unwrap_or("");
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && (1..=5).contains(&ext.len()) && ext.bytes().all(|b| b.is_ascii_alphanumeric()) => {
            format!("<.{} file>", ext.to_ascii_lowercase())
        }
        _ => "<path>".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::redact;

    #[test]
    fn windows_paths_with_spaces() {
        assert_eq!(
            redact(r"media picked: C:\Users\sam\OneDrive\Desktop\Recording 2025-11-12 132938.mp4"),
            "media picked: <.mp4 file>"
        );
        assert_eq!(redact("export saved: D:/Videos/My trip.MP4 (12 bytes)"), "export saved: <.mp4 file> (12 bytes)");
    }

    #[test]
    fn ffmpeg_and_python_messages() {
        assert_eq!(
            redact(r"C:\Users\sam\Videos\a b.mp4: No such file or directory"),
            "<.mp4 file>: No such file or directory"
        );
        assert_eq!(
            redact(r#"  File "C:\Users\sam\AppData\Local\WipeClip\engine\_internal\app\main.py", line 405, in clean"#),
            r#"  File "<.py file>", line 405, in clean"#
        );
        assert_eq!(
            redact(r"FileNotFoundError: [Errno 2] No such file: 'C:\\Users\\sam\\x.m4a'"),
            "FileNotFoundError: [Errno 2] No such file: '<.m4a file>'"
        );
        assert_eq!(redact(r"Error opening output file C:\Users\sam\out.mp4."), "Error opening output file <.mp4 file>.");
    }

    #[test]
    fn other_roots() {
        assert_eq!(redact(r"\\nas\share\clip.mov failed"), "<.mov file> failed");
        assert_eq!(redact("open /Users/sam/Movies/x.mov"), "open <.mov file>");
        assert_eq!(redact("in /home/sam/"), "in <path>");
    }

    #[test]
    fn leaves_other_text_alone() {
        for text in [
            "engine ready on port 52011",
            "blocked navigation to https://example.com/a/b",
            "capture paused at Some(12.0) ms",
            "ratio 16:9, time 00:01:02",
            "",
        ] {
            assert!(matches!(redact(text), std::borrow::Cow::Borrowed(_)), "{text}");
        }
    }
}
