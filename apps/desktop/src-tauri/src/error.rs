//! The one error shape every command returns.
//!
//! Before this, every command did `.map_err(|err| err.message())`, so the
//! frontend received prose and nothing else — `WriteLockError::code()` and
//! `ProfileError::code()` were dead. The UI then had no programmatic way to
//! tell "TF2 is running" from "disk full" and duplicated the copy in five
//! places.
//!
//! The payload serializes as `{ "code": "...", "message": "..." }`. The
//! existing TS `invokeErrorMessage` already reads a `message` field off an
//! object, so the UI keeps working unchanged while `code` becomes available.

use execs_core::{ProfileError, Tf2RootError, WriteLockError};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    /// For failures with no richer classification available (a fetch error, a
    /// `spawn_blocking` join failure, a hand-written sentence).
    pub fn unknown(message: impl Into<String>) -> Self {
        Self::new("Unknown", message)
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl From<ProfileError> for CommandError {
    fn from(err: ProfileError) -> Self {
        Self::new(err.code(), err.message())
    }
}

impl From<WriteLockError> for CommandError {
    fn from(err: WriteLockError) -> Self {
        Self::new(err.code(), err.message())
    }
}

impl From<Tf2RootError> for CommandError {
    fn from(err: Tf2RootError) -> Self {
        Self::new(err.code(), err.message())
    }
}

/// Everything that still speaks in bare strings — the fetch modules, the
/// handful of hand-written command sentences — lands here.
impl From<String> for CommandError {
    fn from(message: String) -> Self {
        Self::unknown(message)
    }
}

impl From<&str> for CommandError {
    fn from(message: &str) -> Self {
        Self::unknown(message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_lock_error_carries_the_game_running_code() {
        let err: CommandError = WriteLockError::GameRunning.into();
        assert_eq!(err.code, "GameRunning");
        assert_eq!(err.message, WriteLockError::GameRunning.message());
    }

    #[test]
    fn profile_errors_keep_their_own_codes_and_prose() {
        let err: CommandError = ProfileError::NoConfirmedRoot.into();
        assert_eq!(err.code, "NoConfirmedRoot");
        assert_eq!(err.message, ProfileError::NoConfirmedRoot.message());

        let io: CommandError = ProfileError::Io("disk full".into()).into();
        assert_eq!(io.code, "Io");

        // The game-running variant must agree with the write lock's own code,
        // so the UI can branch on one string no matter which layer refused.
        let running: CommandError = ProfileError::GameRunning.into();
        assert_eq!(running.code, WriteLockError::GameRunning.code());
    }

    #[test]
    fn bare_strings_become_unknown() {
        let err: CommandError = "Save or switch to a profile first.".into();
        assert_eq!(err.code, "Unknown");
        assert_eq!(err.message, "Save or switch to a profile first.");

        let owned: CommandError = String::from("boom").into();
        assert_eq!(owned.code, "Unknown");
    }

    #[test]
    fn serializes_with_code_and_message() {
        let json = serde_json::to_value(CommandError::new("GameRunning", "nope")).unwrap();
        assert_eq!(json["code"], "GameRunning");
        assert_eq!(json["message"], "nope");
    }
}
