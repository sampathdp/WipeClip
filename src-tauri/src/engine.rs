//! The bundled processing engine: the website's own backend (backend/,
//! started through backend/desktop_engine.py and packaged by
//! backend/desktop.spec), run on this machine so the import check, AI
//! cleanup and export never upload the user's video.
//!
//! Started on first use, not at launch: it takes a few seconds and a few
//! hundred MB of RAM that a user who only records never needs. It listens on
//! 127.0.0.1 on a free port and refuses any request without the random token
//! made here, so other programs and web pages on the machine can't use it.
//! It exits with the app: killed on a normal exit, and it watches the app's
//! process id itself for a crash. It also exits by itself after a few idle
//! minutes (WIPECLIP_IDLE_EXIT in desktop_engine.py) to give its memory back
//! while the user only edits; the next job starts it again.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::async_runtime::Mutex;
use tauri::{AppHandle, Manager, State};

const STARTUP_TIMEOUT: Duration = Duration::from_secs(90);
/// Origins the page calls the engine from (see links::is_app_url). The dev
/// server's origin only in debug builds, which load the page from it.
const ALLOWED_ORIGINS: &str = if cfg!(debug_assertions) {
    "tauri://localhost,http://tauri.localhost,https://tauri.localhost,http://localhost:3100"
} else {
    "tauri://localhost,http://tauri.localhost,https://tauri.localhost"
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    url: String,
    token: String,
}

struct Running {
    child: Child,
    port: u16,
    info: EngineInfo,
}

#[derive(Default)]
pub struct EngineState {
    running: Mutex<Option<Running>>,
}

impl EngineState {
    /// Busy (mid-start) means nothing to kill yet; the engine still exits on
    /// its own once it sees this process is gone.
    pub fn shutdown(&self) {
        let Ok(mut guard) = self.running.try_lock() else { return };
        if let Some(mut running) = guard.take() {
            let _ = running.child.kill();
            let _ = running.child.wait();
        }
    }
}

/// The engine's address and token, starting it if it isn't running. None
/// when this build has no engine (the page then uses the cloud backend).
#[tauri::command]
pub async fn local_engine(app: AppHandle, state: State<'_, EngineState>) -> Result<Option<EngineInfo>, String> {
    let mut running = state.running.lock().await;
    if let Some(r) = running.as_mut() {
        if r.child.try_wait().is_ok_and(|s| s.is_none()) {
            // Counts as activity, so the engine can't go idle between this
            // answer and the page's request. A failed ping alone is no reason
            // to restart (a busy machine can be slow to answer); only an exit is.
            let (port, token) = (r.port, r.info.token.clone());
            let answered = tauri::async_runtime::spawn_blocking(move || healthy(port, &token)).await.unwrap_or(false);
            if answered {
                return Ok(Some(r.info.clone()));
            }
            tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(300))).await.ok();
            if r.child.try_wait().is_ok_and(|s| s.is_none()) {
                return Ok(Some(r.info.clone()));
            }
        }
        match r.child.try_wait() {
            Ok(Some(status)) if status.success() => log::info!("engine had exited while idle; starting it again"),
            _ => log::warn!("engine had stopped; starting it again"),
        }
        *running = None;
    }
    let Some(mut command) = engine_command(&app) else {
        return Ok(None);
    };
    let started = tauri::async_runtime::spawn_blocking(move || start(&mut command))
        .await
        .map_err(|e| e.to_string())??;
    let info = started.info.clone();
    *running = Some(started);
    Ok(Some(info))
}

/// The packaged engine, or in a debug build the backend's own virtualenv.
fn engine_command(app: &AppHandle) -> Option<Command> {
    let exe = if cfg!(windows) { "wipeclip-engine.exe" } else { "wipeclip-engine" };
    if let Ok(dir) = app.path().resource_dir() {
        let packaged = dir.join("engine").join(exe);
        if packaged.is_file() {
            return Some(Command::new(packaged));
        }
    }
    if cfg!(debug_assertions) {
        let backend = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("backend");
        let python = if cfg!(windows) {
            backend.join(".venv").join("Scripts").join("python.exe")
        } else {
            backend.join(".venv").join("bin").join("python")
        };
        if python.is_file() {
            let mut command = Command::new(python);
            command.arg("desktop_engine.py").current_dir(backend);
            return Some(command);
        }
    }
    log::warn!("no local engine in this build");
    None
}

/// The port is free when picked but released before the engine binds it,
/// so another program can take it in between; the engine then exits at
/// once, and one more try on a new port gets past that.
fn start(command: &mut Command) -> Result<Running, String> {
    match try_start(command) {
        Err((true, e)) => {
            log::warn!("{e} Trying again on another port.");
            try_start(command).map_err(|(_, e)| e)
        }
        other => other.map_err(|(_, e)| e),
    }
}

/// Err((exited_early, message)).
fn try_start(command: &mut Command) -> Result<Running, (bool, String)> {
    let fail = |e: String| (false, e);
    // Free port: bind to 0, read it back, release it for the engine.
    let port = TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map_err(|e| fail(format!("No free port for the engine: {e}")))?
        .port();
    let token = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());

    command
        .env("WIPECLIP_LOCAL_PORT", port.to_string())
        .env("WIPECLIP_LOCAL_TOKEN", &token)
        .env("WIPECLIP_PARENT_PID", std::process::id().to_string())
        .env("ALLOWED_ORIGINS", ALLOWED_ORIGINS)
        .env("PYTHONUNBUFFERED", "1")
        // The cloud backend's settings must never leak into the engine.
        .env_remove("INTERNAL_API_SECRET")
        .env_remove("SITE_URL")
        .env_remove("REDIS_URL")
        .env_remove("GCS_UPLOAD_BUCKET")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command.spawn().map_err(|e| fail(format!("Couldn't start the engine: {e}")))?;
    forward_logs(child.stdout.take());
    forward_logs(child.stderr.take());

    let deadline = Instant::now() + STARTUP_TIMEOUT;
    loop {
        if healthy(port, &token) {
            log::info!("engine ready on port {port}");
            let info = EngineInfo { url: format!("http://127.0.0.1:{port}"), token };
            return Ok(Running { child, port, info });
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err((true, format!("The engine stopped while starting ({status}).")));
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            return Err(fail("The engine took too long to start.".into()));
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

fn healthy(port: u16, token: &str) -> bool {
    let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) else { return false };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let request = format!(
        "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-Local-Token: {token}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut head = [0u8; 12];
    stream.read_exact(&mut head).is_ok() && head.starts_with(b"HTTP/1.1 200")
}

fn forward_logs(pipe: Option<impl Read + Send + 'static>) {
    let Some(pipe) = pipe else { return };
    std::thread::spawn(move || {
        for line in BufReader::new(pipe).lines().map_while(Result::ok) {
            log::info!(target: "engine", "{line}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_check_fails_without_a_server() {
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        assert!(!healthy(port, "token"));
    }
}
