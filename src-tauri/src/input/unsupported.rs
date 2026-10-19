//! Platforms without an input monitor (Linux builds): everything reports
//! "unsupported" and recordings simply carry no interaction events.

use std::sync::Arc;

use super::{Permission, Permissions, Sink, WindowInfo};

pub fn permissions() -> Permissions {
    Permissions { mouse: Permission::Unsupported, keyboard: Permission::Unsupported, active_window: Permission::Unsupported }
}

pub fn request_keyboard_access() {}

pub fn cursor_position() -> Option<(f64, f64)> {
    None
}

pub fn foreground_window(_with_title: bool) -> Option<WindowInfo> {
    None
}

pub struct Hooks;

impl Hooks {
    pub fn stop(self) {}
}

pub fn start_hooks(_sink: Arc<Sink>, _mouse: bool, _keyboard: bool) -> Result<(Hooks, Vec<String>), String> {
    Ok((Hooks, vec!["Mouse and keyboard metadata isn't supported on this platform.".to_string()]))
}

pub fn available_space(dir: &std::path::Path) -> std::io::Result<u64> {
    super::unix_available_space(dir)
}
