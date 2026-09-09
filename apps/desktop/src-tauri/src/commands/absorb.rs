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
    with_root(|root| {
        super::preloader::reconcile_active_profile_particles(&root)?;
        Ok(execs_core::absorb_owned(&root)?)
    })
    .await
}

#[tauri::command]
pub async fn absorb_packs(
    gate: tauri::State<'_, WriteGate>,
    choice: PackChoice,
) -> Result<ProfileLibrary, CommandError> {
    let _guard = gate.lock_for_write().await?;
    with_root(move |root| {
        let library = execs_core::absorb_packs(&root, choice)?;
        super::shared::recover_pending_profile_mutations(&root)?;
        super::preloader::reconcile_active_profile_particles(&root)?;
        Ok(library)
    })
    .await
}
