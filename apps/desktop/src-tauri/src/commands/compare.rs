//! Read-only profile previews: the switch comparison and each profile's
//! overview. A switch itself repeats every check.

use crate::commands::shared::{with_profile, with_root};
use crate::error::CommandError;

#[tauri::command]
pub async fn compare_profile_switch(
    target_id: String,
) -> Result<execs_core::profile_compare::ProfileComparison, CommandError> {
    with_profile(move |root, active_id| {
        Ok(execs_core::profile_compare::compare_profiles(
            &execs_core::profiles_dir(),
            &root,
            &active_id,
            &target_id,
        )?)
    })
    .await
}

/// What every saved profile holds, in library order. Needs no active profile.
#[tauri::command]
pub async fn get_setup_overviews(
) -> Result<Vec<execs_core::setup_overview::SetupOverview>, CommandError> {
    with_root(|root| {
        Ok(execs_core::setup_overview::setup_overviews(
            &execs_core::profiles_dir(),
            &root,
        )?)
    })
    .await
}
