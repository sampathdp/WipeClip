//! Recording time for the native tracks, in 100 ns units (the unit of
//! QueryPerformanceCounter-based timestamps that Windows.Graphics.Capture
//! frames and WASAPI packets carry). Pauses are cut out, like the page's
//! RecordingClock does for its own tracks.

use std::sync::Mutex;

use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};

pub const TICKS_PER_SEC: i64 = 10_000_000;

/// Now, as QPC converted to 100 ns ticks (same base as frame timestamps).
pub fn qpc_now() -> i64 {
    let mut c = 0i64;
    let mut f = 0i64;
    unsafe {
        let _ = QueryPerformanceCounter(&mut c);
        let _ = QueryPerformanceFrequency(&mut f);
    }
    if f <= 0 {
        return 0;
    }
    ((c as i128 * TICKS_PER_SEC as i128) / f as i128) as i64
}

#[derive(Default)]
struct Inner {
    t0: Option<i64>,
    paused_since: Option<i64>,
    paused_total: i64,
    stopped_at: Option<i64>,
}

#[derive(Default)]
pub struct Clock {
    inner: Mutex<Inner>,
}

impl Clock {
    pub fn start(&self, at: i64) {
        let mut i = self.inner.lock().unwrap();
        *i = Inner { t0: Some(at), ..Default::default() };
    }

    pub fn set_paused(&self, paused: bool, at: i64) {
        let mut i = self.inner.lock().unwrap();
        if i.stopped_at.is_some() {
            return;
        }
        match (paused, i.paused_since) {
            (true, None) => i.paused_since = Some(at),
            (false, Some(since)) => {
                i.paused_total += (at - since).max(0);
                i.paused_since = None;
            }
            _ => {}
        }
    }

    pub fn stop(&self, at: i64) -> i64 {
        let mut i = self.inner.lock().unwrap();
        if i.stopped_at.is_none() {
            if let Some(since) = i.paused_since.take() {
                i.paused_total += (at - since).max(0);
            }
            i.stopped_at = Some(at);
        }
        let end = i.stopped_at.unwrap();
        (end - i.t0.unwrap_or(end) - i.paused_total).max(0)
    }

    /// Recording time of a host timestamp, None before the start, while
    /// paused and after the stop.
    pub fn rec_time(&self, at: i64) -> Option<i64> {
        let i = self.inner.lock().unwrap();
        let t0 = i.t0?;
        if at < t0 || i.paused_since.is_some() || i.stopped_at.is_some_and(|s| at > s) {
            return None;
        }
        Some(at - t0 - i.paused_total)
    }

    /// Recording time now, also while paused (the time it was paused at).
    pub fn elapsed(&self) -> i64 {
        let now = qpc_now();
        let i = self.inner.lock().unwrap();
        let Some(t0) = i.t0 else { return 0 };
        let end = i.stopped_at.or(i.paused_since).unwrap_or(now);
        (end - t0 - i.paused_total).max(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pauses_are_cut_out() {
        let c = Clock::default();
        c.start(1000);
        assert_eq!(c.rec_time(999), None);
        assert_eq!(c.rec_time(1500), Some(500));
        c.set_paused(true, 2000);
        assert_eq!(c.rec_time(2100), None);
        c.set_paused(false, 3000);
        assert_eq!(c.rec_time(3500), Some(1500));
        assert_eq!(c.stop(4000), 2000);
        assert_eq!(c.rec_time(4100), None);
    }
}
