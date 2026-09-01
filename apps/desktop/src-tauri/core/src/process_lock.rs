//! Refuse live-surface / profile-library writes while TF2 is running.

use serde::Serialize;
use sysinfo::{ProcessesToUpdate, System};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessOs {
    Windows,
    Linux,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteLock {
    pub running: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteLockError {
    GameRunning,
}

impl WriteLockError {
    pub fn code(&self) -> &'static str {
        "GameRunning"
    }

    pub fn message(&self) -> &'static str {
        "TF2 is running — execs is read-only until the game quits."
    }
}

pub fn current_process_os() -> ProcessOs {
    if cfg!(windows) {
        ProcessOs::Windows
    } else {
        ProcessOs::Linux
    }
}

pub fn process_name_is_tf2_for(os: ProcessOs, name: &str) -> bool {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let lower = base.to_ascii_lowercase();
    match os {
        ProcessOs::Windows => lower == "tf_win64.exe" || lower == "tf_win64",
        // Native Linux only. Proton `tf_win64.exe` on Linux is out of scope.
        ProcessOs::Linux => lower == "tf_linux64",
    }
}

pub fn process_name_is_tf2(name: &str) -> bool {
    process_name_is_tf2_for(current_process_os(), name)
}

/// Steam main client only. `steamwebhelper` is not enough to block `localconfig.vdf`.
pub fn process_name_is_steam_for(os: ProcessOs, name: &str) -> bool {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let lower = base.to_ascii_lowercase();
    match os {
        ProcessOs::Windows => lower == "steam.exe" || lower == "steam",
        ProcessOs::Linux => lower == "steam",
    }
}

pub fn process_name_is_steam(name: &str) -> bool {
    process_name_is_steam_for(current_process_os(), name)
}

pub fn steam_running_among_for<I, S>(os: ProcessOs, names: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    names
        .into_iter()
        .any(|name| process_name_is_steam_for(os, name.as_ref()))
}

pub fn steam_running_among<I, S>(names: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    steam_running_among_for(current_process_os(), names)
}

pub fn is_steam_running() -> bool {
    steam_running_among(live_process_names())
}

pub fn tf2_running_among_for<I, S>(os: ProcessOs, names: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    names
        .into_iter()
        .any(|name| process_name_is_tf2_for(os, name.as_ref()))
}

pub fn tf2_running_among<I, S>(names: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    tf2_running_among_for(current_process_os(), names)
}

pub fn live_process_names() -> Vec<String> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys.processes()
        .values()
        .map(|process| process.name().to_string_lossy().into_owned())
        .collect()
}

pub fn is_tf2_running() -> bool {
    tf2_running_among(live_process_names())
}

pub fn write_lock_status() -> WriteLock {
    WriteLock {
        running: is_tf2_running(),
    }
}

/// Wraps every live-surface / profile-library write. Confirming the TF2 root
/// is an app-data settings write and must not call this.
pub fn refuse_if_running() -> Result<(), WriteLockError> {
    refuse_if_running_among(live_process_names())
}

pub fn refuse_if_running_among<I, S>(names: I) -> Result<(), WriteLockError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    refuse_if_running_among_for(current_process_os(), names)
}

pub fn refuse_if_running_among_for<I, S>(os: ProcessOs, names: I) -> Result<(), WriteLockError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    if tf2_running_among_for(os, names) {
        Err(WriteLockError::GameRunning)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_ticket_process_names_only() {
        assert!(process_name_is_tf2_for(ProcessOs::Windows, "tf_win64.exe"));
        assert!(process_name_is_tf2_for(
            ProcessOs::Windows,
            r"C:\games\tf_win64.EXE"
        ));
        assert!(!process_name_is_tf2_for(ProcessOs::Windows, "hl2.exe"));
        assert!(!process_name_is_tf2_for(ProcessOs::Windows, "steam.exe"));
        assert!(!process_name_is_tf2_for(ProcessOs::Windows, "srcds.exe"));

        assert!(process_name_is_tf2_for(ProcessOs::Linux, "tf_linux64"));
        assert!(process_name_is_tf2_for(
            ProcessOs::Linux,
            "/opt/tf/tf_linux64"
        ));
        assert!(!process_name_is_tf2_for(ProcessOs::Linux, "tf_win64.exe"));
        assert!(!process_name_is_tf2_for(ProcessOs::Linux, "hl2_linux"));
        assert!(!process_name_is_tf2_for(ProcessOs::Linux, "steam"));
    }

    #[test]
    fn steam_is_the_main_client_only() {
        assert!(process_name_is_steam_for(ProcessOs::Windows, "steam.exe"));
        assert!(process_name_is_steam_for(
            ProcessOs::Windows,
            r"C:\Program Files\Steam\steam.EXE"
        ));
        assert!(process_name_is_steam_for(ProcessOs::Linux, "steam"));
        assert!(process_name_is_steam_for(
            ProcessOs::Linux,
            "/usr/bin/steam"
        ));
        assert!(!process_name_is_steam_for(
            ProcessOs::Windows,
            "steamwebhelper.exe"
        ));
        assert!(!process_name_is_steam_for(
            ProcessOs::Linux,
            "steamwebhelper"
        ));
        assert!(!process_name_is_steam_for(ProcessOs::Linux, "tf_linux64"));
        assert!(steam_running_among_for(ProcessOs::Linux, ["bash", "steam"]));
        assert!(!steam_running_among_for(
            ProcessOs::Linux,
            ["steamwebhelper", "tf_linux64"]
        ));
    }

    #[test]
    fn refuse_is_typed_not_silent() {
        let err =
            refuse_if_running_among_for(ProcessOs::Linux, ["reaper", "tf_linux64"]).unwrap_err();
        assert_eq!(err, WriteLockError::GameRunning);
        assert_eq!(err.code(), "GameRunning");
        assert!(refuse_if_running_among_for(ProcessOs::Linux, ["bash", "steam"]).is_ok());
        assert!(refuse_if_running_among_for(ProcessOs::Windows, ["steam.exe"]).is_ok());
        assert!(refuse_if_running_among_for(ProcessOs::Windows, ["tf_win64.exe"]).is_err());
    }
}
