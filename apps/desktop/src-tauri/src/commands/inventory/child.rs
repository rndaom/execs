//! Bounded disposable Steam process; uncertain exits never imply a mutation failed.
use super::{failure, CommandError};
use serde::de::DeserializeOwned;
use std::{
    io::{Read, Write},
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

const MAX_BYTES: usize = 32 * 1024 * 1024;

pub(super) fn request<T: DeserializeOwned>(
    root: &Path,
    operation: Option<&[u8]>,
) -> Result<T, CommandError> {
    let library = root.join(if cfg!(windows) {
        "bin/x64/steam_api64.dll"
    } else {
        "bin/linux64/libsteam_api.so"
    });
    if !library.is_file() {
        return Err(failure(
            "The installed TF2 Steam library could not be found.",
        ));
    }
    if operation.is_some_and(|bytes| bytes.len() > MAX_BYTES) {
        return Err(failure("Inventory operation exceeds its limit."));
    }
    let mut command = Command::new(std::env::current_exe().map_err(|e| failure(e.to_string()))?);
    command
        .arg(if operation.is_some() {
            "--inventory-operation"
        } else {
            "--inventory-read"
        })
        .arg(library)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .stdin(if operation.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        });
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().map_err(|e| failure(e.to_string()))?;
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(failure("Inventory helper output unavailable"));
        }
    };
    let input = if let Some(bytes) = operation {
        let Some(mut stdin) = child.stdin.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(failure("Inventory helper input unavailable"));
        };
        let bytes = bytes.to_vec();
        Some(std::thread::spawn(move || stdin.write_all(&bytes)))
    } else {
        None
    };
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(MAX_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let started = Instant::now();
    let timeout = Duration::from_secs(if operation.is_some() { 55 } else { 40 });
    let status = loop {
        let guard = execs_core::refuse_if_running()
            .map_err(CommandError::from)
            .and_then(|_| {
                super::RootContext::capture(root)
                    .ensure_current(&super::super::shared::confirmed_root()?)
            });
        match (guard, child.try_wait()) {
            (Ok(()), Ok(Some(status))) => break Ok(status),
            (Ok(()), Ok(None)) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(100))
            }
            (guard, result) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(guard.err().unwrap_or_else(|| failure(match result { Err(e) => e.to_string(), _ => "Steam inventory helper timed out. Reconcile any pending operation before retrying.".into() })));
            }
        }
    };
    let bytes = reader
        .join()
        .map_err(|_| failure("Inventory reader stopped"))?
        .map_err(|e| failure(e.to_string()))?;
    if let Some(input) = input {
        input
            .join()
            .map_err(|_| failure("Inventory writer stopped"))?
            .map_err(|e| failure(e.to_string()))?;
    }
    if !status?.success() {
        return Err(failure("Steam inventory helper stopped unexpectedly. Reconcile any pending operation before retrying."));
    }
    if bytes.len() > MAX_BYTES {
        return Err(failure("Inventory response exceeds limit"));
    }
    let output = String::from_utf8(bytes).map_err(|_| failure("Invalid inventory response"))?;
    let prefix = if operation.is_some() {
        "EXECS_INVENTORY_OPERATION:"
    } else {
        "EXECS_INVENTORY:"
    };
    let records: Vec<_> = output
        .lines()
        .filter_map(|line| line.strip_prefix(prefix))
        .collect();
    if records.len() != 1 {
        return Err(failure(
            "Steam did not return exactly one inventory result.",
        ));
    }
    let response: Result<T, String> =
        serde_json::from_str(records[0]).map_err(|_| failure("Invalid inventory result"))?;
    response.map_err(failure)
}
