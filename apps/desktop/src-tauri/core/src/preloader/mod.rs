//! The casual preloader: reversible `gameinfo.txt` bypass plus in-place
//! particle patches inside `tf2_misc_dir.vpk`, with pristine snapshots of
//! every byte we touch so one click restores stock files.
//!
//! Allowed by an explicit product decision (see AGENTS.md, dated 2026-08-31):
//! these are the only official-file edits the app may make, they must stay
//! size-preserving, snapshot-first, and fully revertible, and they never run
//! while the game is open.

pub const PRELOADER_VPK: &str = "execs-preloader.vpk";
pub const MISC_VPK: &str = "tf2_misc_dir.vpk";

/// Preserve the structured command error even though the legacy preloader API
/// returns strings for format/IO failures.
pub fn is_game_running_error(message: &str) -> bool {
    let locked = crate::process_lock::WriteLockError::GameRunning.message();
    message == locked
        || message
            .strip_prefix(locked)
            .is_some_and(|rest| rest.starts_with(';'))
}
/// Official archives holding the assets the pure whitelist trusts.
pub const STOCK_VPKS: [&str; 3] = [
    "tf2_textures_dir.vpk",
    "tf2_misc_dir.vpk",
    "tf2_sound_misc_dir.vpk",
];
/// Roots a loose `tf/custom` file cannot serve from.
///
/// Materials and models are deliberately absent: the gameinfo `type` bypass
/// plus the itemtest preload carry those into the cache before Casual's pure
/// check runs, which is the whole point of the preloader. Particles are here
/// because they are patched into the official VPK in place instead, and sound
/// because the soundscript relocation that would make it work is not built.
const TRUSTED_ROOTS: [&str; 2] = ["particles/", "sound/"];

/// Stock files that carry duplicated copies of systems owned by other files.
/// When particle mods are installed these get rebuilt from vanilla with the
/// duplicates dropped, so the mods aren't shadowed.
pub const DUPLICATE_EFFECT_FILES: [&str; 4] = [
    "item_fx.pcf",
    "halloween.pcf",
    "bigboom.pcf",
    "dirty_explode.pcf",
];

/// Stems that also ship a `_dx80` twin the engine can pick; both copies get
/// the same replacement so the effect can't split by DirectX level.
pub const DX8_TWIN_STEMS: [&str; 22] = [
    "burningplayer",
    "cig_smoke",
    "bigboom",
    "player_recent_teleport",
    "water",
    "bl_killtaunt",
    "blood_trail",
    "class_fx",
    "drg_cowmangler",
    "drg_pyro",
    "explosion",
    "eyeboss",
    "firstperson_weapon_fx",
    "flamethrower",
    "harbor_fx",
    "medicgun_beam",
    "muzzle_flash",
    "rockettrail",
    "shellejection",
    "smoke_blackbillow",
    "soldierbuff",
    "stickybomb",
];

// ---------------------------------------------------------------------------
// gameinfo.txt bypass
// ---------------------------------------------------------------------------
mod apply;
mod catalog;
mod gameinfo;
mod pack;
mod profiles;
pub(crate) use profiles::selection_for_snapshot;
pub use profiles::{
    apply_profile_preloader, capture_installed_selections, clear_saved_profile_selection,
    prepare_profile_preloader, selection_for_export, ProfileContext, MODS_RELEASE, MODS_SHA256,
};
mod state;
mod transaction;

// The public API is exactly what `preloader.rs` exported before the split.
pub use apply::{
    apply_preloader_selection, apply_preloader_selection_with_sampler, forget_preload_profile,
    preload_profiles, preloader_status, rebuild_keep_lists, record_preload_profile,
    recover_pending_preloader, recover_pending_preloader_with_sampler, revert_preloader,
    revert_preloader_with_sampler, take_preload_profiles, PreloaderReport, PreloaderSelection,
    PreloaderStatus, RevertReport,
};
pub use catalog::{read_mods_catalog, CatalogAddon, CatalogParticleMod, ModsCatalog};
pub use gameinfo::{
    gameinfo_bypass_state, restore_gameinfo_from_backup, restore_gameinfo_from_backup_with_sampler,
    set_gameinfo_bypass, set_gameinfo_bypass_with_sampler, GameinfoBypass,
};
pub use state::{preload_is_wanted, PatchedEntry, PreloaderState, SkipNotice};
pub use transaction::{
    preloader_transaction_status, prepare_preloader_steam_repair,
    reconcile_preloader_after_steam_repair, reconcile_preloader_after_steam_repair_with_sampler,
    PreloaderTransactionStatus,
};

#[cfg(test)]
mod tests;
