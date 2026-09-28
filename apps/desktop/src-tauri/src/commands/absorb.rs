//! Absorbing drift back into the active profile after TF2 quits.

use execs_core::{AbsorbOwnedResult, PackChoice, ProfileLibrary};

use super::shared::with_root;
use crate::error::CommandError;
use crate::WriteGate;

#[tauri::command]
pub async fn absorb_owned(
    gate: tauri::State<'_, WriteGate>,
) -> Result<AbsorbOwnedResult, CommandError> {
    let _guard = gate.lock_for_write().await?;
    let result = with_root(|root| Ok(execs_core::absorb_owned(&root)?)).await;
    if let Ok(absorbed) = &result {
        if absorbed.config_cfg_absorbed || !absorbed.repaired.is_empty() {
            execs_core::activity_log::record(
                "absorb",
                &format!(
                    "Took changes from TF2 into the active profile (config.cfg: {}, repaired packs: {})",
                    if absorbed.config_cfg_absorbed { "changed" } else { "same" },
                    absorbed.repaired.len()
                ),
            );
        }
    }
    result
}

#[tauri::command]
pub async fn absorb_packs(
    gate: tauri::State<'_, WriteGate>,
    choice: PackChoice,
) -> Result<ProfileLibrary, CommandError> {
    let _guard = gate.lock_for_write().await?;
    let result = with_root(move |root| {
        let library = execs_core::absorb_packs(&root, choice)?;
        super::shared::recover_pending_profile_mutations(&root)?;
        Ok(library)
    })
    .await;
    super::shared::logged("Applied a custom pack decision", result)
}

#[tauri::command]
pub async fn resolve_pack_changes(
    gate: tauri::State<'_, WriteGate>,
    request: execs_core::PackReviewRequest,
) -> Result<ProfileLibrary, CommandError> {
    let _guard = gate.lock_for_write().await?;
    let result = with_root(move |root| {
        let library = execs_core::resolve_pack_changes(&root, request)?;
        super::shared::recover_pending_profile_mutations(&root)?;
        Ok(library)
    })
    .await;
    super::shared::logged("Applied custom pack decisions", result)
}
