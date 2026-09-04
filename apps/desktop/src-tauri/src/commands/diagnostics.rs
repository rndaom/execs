//! One block of text for a bug report: version, OS, where TF2 is, which
//! profile is active, and the tail of the crash log.

use std::fmt::Write as _;
use std::path::Path;

use tauri::AppHandle;

use crate::commands::shared::blocking;
use crate::error::CommandError;

/// How much of `panic.log` to include. The newest lines are the useful ones.
const PANIC_LOG_TAIL_LINES: usize = 20;
const PANIC_LOG_TAIL_BYTES: u64 = 64 * 1024;
const PANIC_LOG_READ_MAX_BYTES: u64 = 2 * 1024 * 1024;

#[tauri::command]
pub async fn get_diagnostics(app: AppHandle) -> Result<String, CommandError> {
    let version = app.package_info().version.to_string();
    blocking(move || Ok(diagnostics_text(&version))).await
}

fn diagnostics_text(version: &str) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "execs {version}");
    let _ = writeln!(out, "OS: {}", execs_core::os_description());
    match execs_core::remembered_tf2_root() {
        Some(root) => {
            let _ = writeln!(out, "TF2: {}", root.display());
            let custom = root.join("tf").join("custom");
            let _ = writeln!(
                out,
                "mastercomfig base VPK: {}",
                if custom.join("mastercomfig-base.vpk").is_file() {
                    "present"
                } else {
                    "absent"
                }
            );
            match execs_core::load_library(Some(&root)) {
                Ok(library) => {
                    let active = library.active_profile_id.as_deref().and_then(|id| {
                        library
                            .profiles
                            .iter()
                            .find(|profile| profile.id == id)
                            .map(|profile| profile.name.clone())
                    });
                    let _ = writeln!(
                        out,
                        "Profiles: {} ({})",
                        library.profiles.len(),
                        active.map_or("none active".to_string(), |name| format!("active: {name}"))
                    );
                }
                Err(err) => {
                    let _ = writeln!(out, "Profiles: could not read the library ({err:?})");
                }
            }
        }
        None => {
            let _ = writeln!(out, "TF2: no folder confirmed yet");
        }
    }
    let _ = writeln!(
        out,
        "TF2 running: {}",
        if execs_core::is_tf2_running() {
            "yes"
        } else {
            "no"
        }
    );
    if let Ok(dir) = execs_core::try_execs_data_dir() {
        let log = dir.join("logs").join("panic.log");
        match read_panic_log_tail(&dir, &log) {
            Ok(lines) => {
                let _ = writeln!(out, "\npanic.log (last {} lines):", lines.len());
                for line in lines {
                    let _ = writeln!(out, "{line}");
                }
            }
            Err(_) => {
                let _ = writeln!(out, "panic.log: none");
            }
        }
    }
    out
}

fn read_panic_log_tail(root: &Path, path: &Path) -> Result<Vec<String>, String> {
    let bytes =
        execs_core::archive::read_regular_file_bounded_within(root, path, PANIC_LOG_READ_MAX_BYTES)
            .map_err(|err| err.message().to_string())?
            .ok_or_else(|| "panic.log exceeds the diagnostics read limit".to_string())?;
    let len = bytes.len() as u64;
    let offset = len.saturating_sub(PANIC_LOG_TAIL_BYTES);
    let tail = &bytes[offset as usize..];
    let text = String::from_utf8_lossy(tail);
    let mut lines: Vec<&str> = text.lines().collect();
    if offset > 0 && !lines.is_empty() {
        // The bounded read can begin in the middle of one oversized line.
        lines.remove(0);
    }
    let start = lines.len().saturating_sub(PANIC_LOG_TAIL_LINES);
    Ok(lines[start..]
        .iter()
        .map(|line| (*line).to_string())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_log(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "execs-diagnostics-{name}-{}-{}.log",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn tail_read_is_byte_bounded_and_drops_a_partial_first_line() {
        let path = temp_log("bounded");
        let mut content = "x".repeat(PANIC_LOG_TAIL_BYTES as usize + 1024);
        content.push_str("\nnewest one\nnewest two\n");
        std::fs::write(&path, content).unwrap();

        let root = path.parent().unwrap();
        let lines = read_panic_log_tail(root, &path).unwrap();
        assert_eq!(lines, ["newest one", "newest two"]);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn tail_read_keeps_only_the_last_twenty_lines() {
        let path = temp_log("lines");
        let content = (0..40)
            .map(|index| format!("line {index}"))
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(&path, content).unwrap();

        let root = path.parent().unwrap();
        let lines = read_panic_log_tail(root, &path).unwrap();
        assert_eq!(lines.len(), PANIC_LOG_TAIL_LINES);
        assert_eq!(lines.first().map(String::as_str), Some("line 20"));
        assert_eq!(lines.last().map(String::as_str), Some("line 39"));
        std::fs::remove_file(path).unwrap();
    }
}
