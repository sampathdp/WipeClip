//! Which URLs the app window may show, and which may be opened in the
//! system browser.

use tauri::Url;
use tauri_plugin_opener::OpenerExt;

/// The bundled app itself: tauri://localhost on macOS/Linux,
/// http(s)://tauri.localhost on Windows, and the desktop dev server in debug
/// builds.
pub fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || (cfg!(debug_assertions) && url.host_str() == Some("localhost") && url.port() == Some(3100))
        }
        _ => false,
    }
}

/// Hosts the app opens in the system browser: the website (pricing, terms,
/// account pages) and Supabase (the Google sign-in hop).
fn is_allowed_external(url: &Url) -> bool {
    let Some(host) = url.host_str() else { return false };
    if url.scheme() == "https" {
        return host == "wipeclip.co" || host == "www.wipeclip.co" || host.ends_with(".supabase.co");
    }
    // Local website during development.
    cfg!(debug_assertions) && url.scheme() == "http" && (host == "localhost" || host == "127.0.0.1")
}

pub fn open_external_url(app: &tauri::AppHandle, raw: &str) -> Result<(), String> {
    let url = Url::parse(raw).map_err(|_| "Invalid link.".to_string())?;
    if !is_allowed_external(&url) {
        return Err(format!("WipeClip doesn't open links to {}.", url.host_str().unwrap_or("that address")));
    }
    app.opener().open_url(url.as_str(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    open_external_url(&app, &url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_urls() {
        assert!(is_app_url(&Url::parse("tauri://localhost/").unwrap()));
        assert!(is_app_url(&Url::parse("http://tauri.localhost/index.html").unwrap()));
        assert!(!is_app_url(&Url::parse("https://www.wipeclip.co/").unwrap()));
        assert!(!is_app_url(&Url::parse("tauri://evil.example/").unwrap()));
        assert!(!is_app_url(&Url::parse("file:///C:/Windows/").unwrap()));
    }

    #[test]
    fn external_allowlist() {
        assert!(is_allowed_external(&Url::parse("https://www.wipeclip.co/pricing").unwrap()));
        assert!(is_allowed_external(&Url::parse("https://abc.supabase.co/auth/v1/authorize").unwrap()));
        assert!(!is_allowed_external(&Url::parse("http://www.wipeclip.co/").unwrap()));
        assert!(!is_allowed_external(&Url::parse("https://wipeclip.co.evil.example/").unwrap()));
        assert!(!is_allowed_external(&Url::parse("https://evil.example/?u=www.wipeclip.co").unwrap()));
        assert!(!is_allowed_external(&Url::parse("javascript:alert(1)").unwrap()));
        assert!(!is_allowed_external(&Url::parse("file:///etc/passwd").unwrap()));
    }
}
