//! Read-only switch preview. The switch itself repeats every check.

use crate::commands::shared::with_profile;
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
