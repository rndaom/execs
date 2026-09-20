//! Development-only read-only backpack snapshot. Steam runs in a disposable
//! child so SDK faults, environment changes and shutdown cannot affect Tauri.
use super::shared::{with_root, RootContext};
use crate::{error::CommandError, WriteGate};
use execs_inventory_probe::Snapshot;
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Read,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    #[serde(flatten)]
    snapshot: Snapshot,
    definitions: BTreeMap<u32, execs_core::inventory::Definition>,
    warning: Option<String>,
}

fn failure(message: impl Into<String>) -> CommandError {
    CommandError::new("InventoryUnavailable", message)
}

fn read_snapshot(root: &std::path::Path) -> Result<Snapshot, CommandError> {
    let library = if cfg!(windows) {
        root.join("bin/x64/steam_api64.dll")
    } else {
        root.join("bin/linux64/libsteam_api.so")
    };
    if !library.is_file() {
        return Err(failure(
            "The installed TF2 Steam library could not be found.",
        ));
    }
    let executable = std::env::current_exe().map_err(|e| failure(e.to_string()))?;
    let mut command = Command::new(executable);
    command
        .arg("--inventory-read")
        .arg(library)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().map_err(|e| failure(e.to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| failure("Inventory helper output unavailable"))?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(8 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if start.elapsed() < Duration::from_secs(40) => {
                std::thread::sleep(Duration::from_millis(50))
            }
            result => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(failure(match result {
                    Err(e) => e.to_string(),
                    _ => "Steam inventory connection timed out. Check Steam and retry.".into(),
                }));
            }
        }
    };
    let bytes = reader
        .join()
        .map_err(|_| failure("Inventory reader stopped"))?
        .map_err(|e| failure(e.to_string()))?;
    if !status?.success() {
        return Err(failure(
            "Steam inventory helper stopped unexpectedly. No items were changed.",
        ));
    }
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(failure("Inventory response exceeds limit"));
    }
    let output = String::from_utf8(bytes).map_err(|_| failure("Invalid inventory response"))?;
    let records: Vec<_> = output
        .lines()
        .filter_map(|l| l.strip_prefix("EXECS_INVENTORY:"))
        .collect();
    if records.len() != 1 {
        return Err(failure("Steam did not return an inventory snapshot"));
    }
    let response: Result<Snapshot, String> =
        serde_json::from_str(records[0]).map_err(|_| failure("Invalid inventory snapshot"))?;
    response.map_err(failure)
}

#[tauri::command]
pub async fn get_inventory(gate: tauri::State<'_, WriteGate>) -> Result<Inventory, CommandError> {
    if !cfg!(debug_assertions) {
        return Err(failure(
            "Inventory is currently available only in development builds.",
        ));
    }
    // Serialize against another connection and against Launch TF2/install changes.
    let _guard = gate.lock_for_interrupted_recovery().await?;
    with_root(|root| {
        execs_core::refuse_if_running()?;
        let context = RootContext::capture(&root);
        let snapshot = read_snapshot(&root)?;
        let ids: BTreeSet<_> = snapshot.items.iter().map(|i| i.definition).collect();
        let (definitions, warning) = match execs_core::inventory::definitions(&root, &ids) {
            Ok(definitions) => {
                let missing = ids.len().saturating_sub(definitions.len());
                (
                    definitions,
                    (missing > 0).then(|| {
                        format!("Names and artwork are unavailable for {missing} item definitions.")
                    }),
                )
            }
            Err(error) => (
                BTreeMap::new(),
                Some(format!(
                    "Local item descriptions could not be read: {error}"
                )),
            ),
        };
        context.ensure_current(&super::shared::confirmed_root()?)?;
        execs_core::refuse_if_running()?;
        Ok(Inventory {
            snapshot,
            definitions,
            warning,
        })
    })
    .await
}

#[tauri::command]
pub async fn get_inventory_icons(
    paths: Vec<String>,
) -> Result<BTreeMap<String, execs_core::inventory::Icon>, CommandError> {
    if !cfg!(debug_assertions) {
        return Err(failure(
            "Inventory is currently available only in development builds.",
        ));
    }
    with_root(move |root| execs_core::inventory::icons(&root, &paths).map_err(failure)).await
}
