//! The app's entry point to the activity log in `logs/activity.log`.
//!
//! Unit tests in this crate build errors and fail fake downloads on purpose;
//! they must never append those lines to the developer's real execs data
//! folder, so recording is a no-op under `cfg(test)`. Core tests exercise the
//! log itself against temporary folders.

#[cfg(not(test))]
pub fn record(kind: &str, message: &str) {
    execs_core::activity_log::record(kind, message);
}

#[cfg(test)]
pub fn record(_kind: &str, _message: &str) {}
