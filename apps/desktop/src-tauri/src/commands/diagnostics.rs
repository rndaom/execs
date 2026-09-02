//! One block of text for a bug report: version, OS, where TF2 is, which
//! profile is active, and the tail of the crash log.

use std::fmt::Write as _;

use tauri::AppHandle;

use crate::commands::shared::blocking;
use crate::error::CommandError;

/// How much of `panic.log` to include. The newest lines are the useful ones.
const PANIC_LOG_TAIL_LINES: usize = 20;

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
        match std::fs::read_to_string(&log) {
            Ok(text) => {
                let lines: Vec<&str> = text.lines().collect();
                let start = lines.len().saturating_sub(PANIC_LOG_TAIL_LINES);
                let _ = writeln!(out, "\npanic.log (last {} lines):", lines.len() - start);
                for line in &lines[start..] {
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
