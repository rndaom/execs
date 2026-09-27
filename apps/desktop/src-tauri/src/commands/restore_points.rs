//! Local restore points: saved profile exports in app data, restored as new
//! inactive profiles. Nothing here writes the live TF2 folder.

use execs_core::restore_points::{self, RestorePoint, RestorePointList};
use execs_core::ProfileLibrary;

use super::shared::{blocking, with_root};
use crate::error::CommandError;
use crate::WriteGate;

fn data_dir() -> Result<std::path::PathBuf, CommandError> {
    execs_core::try_execs_data_dir().map_err(CommandError::unknown)
}

#[tauri::command]
pub async fn list_restore_points() -> Result<RestorePointList, CommandError> {
    blocking(|| Ok(restore_points::list_restore_points(&data_dir()?)?)).await
}

/// A library read: allowed while TF2 runs, serialized with profile writes so
/// the export never observes a half-committed profile.
#[tauri::command]
pub async fn create_restore_point(
    gate: tauri::State<'_, WriteGate>,
    profile_id: String,
    label: Option<String>,
) -> Result<RestorePoint, CommandError> {
    let _guard = gate.lock_for_library_read().await?;
    with_root(move |root| {
        Ok(restore_points::create_restore_point(
            &execs_core::profiles_dir(),
            &data_dir()?,
            &root,
            &profile_id,
            label.as_deref(),
        )?)
    })
    .await
}

#[tauri::command]
pub async fn delete_restore_point(
    gate: tauri::State<'_, WriteGate>,
    id: String,
) -> Result<RestorePointList, CommandError> {
    let _guard = gate.writes.lock().await;
    blocking(move || Ok(restore_points::delete_restore_point(&data_dir()?, &id)?)).await
}

#[tauri::command]
pub async fn set_restore_point_retention(
    gate: tauri::State<'_, WriteGate>,
    keep: u32,
) -> Result<RestorePointList, CommandError> {
    let _guard = gate.writes.lock().await;
    blocking(move || Ok(restore_points::set_keep_per_profile(&data_dir()?, keep)?)).await
}

#[tauri::command]
pub async fn compare_restore_point(
    id: String,
) -> Result<execs_core::profile_compare::ProfileComparison, CommandError> {
    with_root(move |root| {
        Ok(restore_points::compare_restore_point(
            &execs_core::profiles_dir(),
            &data_dir()?,
            &root,
            &id,
        )?)
    })
    .await
}

#[tauri::command]
pub async fn restore_restore_point(
    gate: tauri::State<'_, WriteGate>,
    id: String,
    name: String,
) -> Result<ProfileLibrary, CommandError> {
    let _guard = gate.lock_for_write().await?;
    with_root(move |root| {
        execs_core::refuse_if_running()?;
        if super::shared::profile_recovery_required(&root)? {
            return Err(CommandError::new(
                "RecoveryRequired",
                "Finish the interrupted profile operation before restoring.",
            ));
        }
        Ok(restore_points::restore_restore_point(
            &execs_core::profiles_dir(),
            &data_dir()?,
            &root,
            &id,
            &name,
            execs_core::process_lock::live_process_names(),
        )?)
    })
    .await
}
