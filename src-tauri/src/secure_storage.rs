//! Storage for the Supabase sign-in session, in the OS credential store
//! (Windows Credential Manager, macOS Keychain) instead of the WebView's
//! plaintext localStorage. Used by src/lib/platform/secureStorage.ts.
//!
//! Only Supabase's own auth keys are accepted, so this can't become a
//! general-purpose secret store for whatever script runs in the page.
//! Windows caps one credential at 2560 bytes and a session is larger, so
//! long values are split across numbered entries.

use keyring::Entry;

const SERVICE: &str = "co.wipeclip.desktop";
const CHUNK_BYTES: usize = 1000;
const MAX_CHUNKS: usize = 64;
const HEADER: &str = "wipeclip-chunks:";

/// Supabase's auth keys only: `sb-<project>-auth-token` (the session) and
/// its suffixes - the PKCE verifier, the user object, and since supabase-js
/// 2.11x one verifier per pending sign-in (`-flow-<id>-code-verifier`, id
/// as auth-js validates it: [A-Za-z0-9_-]{8,64}) plus their index.
fn check_key(key: &str) -> Result<(), String> {
    let ok = key.len() <= 160 && key_is_supabase_auth(key);
    if ok {
        Ok(())
    } else {
        Err("Unsupported storage key.".into())
    }
}

fn key_is_supabase_auth(key: &str) -> bool {
    let Some(rest) = key.strip_prefix("sb-") else { return false };
    let Some(at) = rest.find("-auth-token") else { return false };
    let (project, suffix) = (&rest[..at], &rest[at + "-auth-token".len()..]);
    if project.is_empty() || !project.chars().all(|c| c.is_ascii_alphanumeric()) {
        return false;
    }
    match suffix {
        "" | "-code-verifier" | "-user" | "-flows-code-verifier" => true,
        _ => suffix
            .strip_prefix("-flow-")
            .and_then(|s| s.strip_suffix("-code-verifier"))
            .is_some_and(|id| (8..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')),
    }
}

fn entry(name: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, name).map_err(|e| e.to_string())
}

fn read(name: &str) -> Result<Option<String>, String> {
    match entry(name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn delete(name: &str) -> Result<(), String> {
    match entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn chunk_count(header: &str) -> Option<usize> {
    header.strip_prefix(HEADER)?.parse().ok().filter(|n| *n <= MAX_CHUNKS)
}

/// Splits at char boundaries into pieces of at most CHUNK_BYTES bytes.
fn split(value: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut end = 0;
    for (i, c) in value.char_indices() {
        if i + c.len_utf8() - start > CHUNK_BYTES {
            parts.push(&value[start..end]);
            start = i;
        }
        end = i + c.len_utf8();
    }
    if start < value.len() {
        parts.push(&value[start..]);
    }
    parts
}

#[tauri::command]
pub fn secure_storage_get(key: String) -> Result<Option<String>, String> {
    check_key(&key)?;
    let Some(head) = read(&key)? else { return Ok(None) };
    let Some(n) = chunk_count(&head) else { return Ok(Some(head)) };
    let mut value = String::new();
    for i in 0..n {
        match read(&format!("{key}#{i}"))? {
            Some(part) => value.push_str(&part),
            None => return Ok(None), // incomplete write - treat as signed out
        }
    }
    Ok(Some(value))
}

#[tauri::command]
pub fn secure_storage_set(key: String, value: String) -> Result<(), String> {
    check_key(&key)?;
    secure_storage_remove(key.clone())?;
    if value.len() <= CHUNK_BYTES && !value.starts_with(HEADER) {
        return entry(&key)?.set_password(&value).map_err(|e| e.to_string());
    }
    let parts = split(&value);
    if parts.len() > MAX_CHUNKS {
        return Err("Value too large.".into());
    }
    for (i, part) in parts.iter().enumerate() {
        entry(&format!("{key}#{i}"))?.set_password(part).map_err(|e| e.to_string())?;
    }
    // Header last: a crash mid-write leaves no header, i.e. no session.
    entry(&key)?
        .set_password(&format!("{HEADER}{}", parts.len()))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secure_storage_remove(key: String) -> Result<(), String> {
    check_key(&key)?;
    if let Some(n) = read(&key)?.as_deref().and_then(chunk_count) {
        for i in 0..n {
            delete(&format!("{key}#{i}"))?;
        }
    }
    delete(&key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys() {
        assert!(check_key("sb-cvsxgovnuytsgbbavjvq-auth-token").is_ok());
        assert!(check_key("sb-cvsxgovnuytsgbbavjvq-auth-token-code-verifier").is_ok());
        assert!(check_key("sb-cvsxgovnuytsgbbavjvq-auth-token-user").is_ok());
        assert!(check_key("theme").is_err());
        assert!(check_key("sb-x-auth-token-other").is_err());
        assert!(check_key("sb-cvsxgovnuytsgbbavjvq-auth-token-flows-code-verifier").is_ok());
        assert!(check_key("sb-cvsxgovnuytsgbbavjvq-auth-token-flow-0f3a9c2e7b1d4f6a8c0e2b4d6f8a1c3e-code-verifier").is_ok());
        assert!(check_key("sb-x-auth-token-flow-short-code-verifier").is_err());
        assert!(check_key("sb-x-auth-token-flow-abc/../../x-code-verifier").is_err());
        assert!(check_key("sb--auth-token").is_err());
        assert!(check_key("sb-x-auth-token#0").is_err());
        assert!(check_key("sb-../../-auth-token").is_err());
    }

    #[test]
    fn splitting() {
        let ascii = "a".repeat(2500);
        let parts = split(&ascii);
        assert_eq!(parts.len(), 3);
        assert!(parts.iter().all(|p| p.len() <= CHUNK_BYTES));
        assert_eq!(parts.concat(), ascii);

        let wide = "é".repeat(1500); // 2 bytes each
        let parts = split(&wide);
        assert!(parts.iter().all(|p| p.len() <= CHUNK_BYTES));
        assert_eq!(parts.concat(), wide);

        assert_eq!(chunk_count("wipeclip-chunks:3"), Some(3));
        assert_eq!(chunk_count("wipeclip-chunks:9999"), None);
        assert_eq!(chunk_count("{\"access_token\":1}"), None);
    }
}
