//! What this machine has to work with, so the page can size memory-hungry
//! work (caption workers today) to the real computer. WebView2 reports
//! `navigator.deviceMemory` capped at 8 GB and WKWebView not at all, so the
//! page can't tell a 4 GB laptop from a 32 GB workstation on its own.

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMemory {
    total_bytes: Option<u64>,
    /// Free right now, where the OS reports it cheaply (Windows, Linux).
    available_bytes: Option<u64>,
    cores: usize,
}

#[tauri::command]
pub fn system_memory() -> SystemMemory {
    let (total_bytes, available_bytes) = memory();
    SystemMemory {
        total_bytes,
        available_bytes,
        cores: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
    }
}

#[cfg(windows)]
fn memory() -> (Option<u64>, Option<u64>) {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    // SAFETY: dwLength set as the API requires, struct otherwise zeroed.
    unsafe {
        let mut status: MEMORYSTATUSEX = std::mem::zeroed();
        status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut status) == 0 {
            return (None, None);
        }
        (Some(status.ullTotalPhys), Some(status.ullAvailPhys))
    }
}

#[cfg(target_os = "macos")]
fn memory() -> (Option<u64>, Option<u64>) {
    let mut total: u64 = 0;
    let mut size = std::mem::size_of::<u64>();
    // SAFETY: NUL-terminated name, output buffer and its size match.
    let ok = unsafe {
        libc::sysctlbyname(c"hw.memsize".as_ptr(), (&mut total as *mut u64).cast(), &mut size, std::ptr::null_mut(), 0) == 0
    };
    // "Available" on macOS (free + inactive + purgeable pages) needs the Mach
    // VM statistics; total is enough for sizing.
    (ok.then_some(total), None)
}

#[cfg(target_os = "linux")]
fn memory() -> (Option<u64>, Option<u64>) {
    // SAFETY: zeroed out struct filled by the kernel.
    unsafe {
        let mut info: libc::sysinfo = std::mem::zeroed();
        if libc::sysinfo(&mut info) != 0 {
            return (None, None);
        }
        let unit = info.mem_unit as u64;
        (Some(info.totalram as u64 * unit), Some((info.freeram as u64 + info.bufferram as u64) * unit))
    }
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn memory() -> (Option<u64>, Option<u64>) {
    (None, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_this_machines_memory() {
        let m = system_memory();
        assert!(m.cores >= 1);
        if let (Some(total), Some(available)) = (m.total_bytes, m.available_bytes) {
            assert!(total > 0 && available <= total);
        }
    }
}
