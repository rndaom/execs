pub mod absorb;
pub mod blob;
pub mod finder;
pub mod hash;
pub mod launch;
pub mod process_lock;
pub mod profile;
pub mod settings;
pub mod steam_inf;
pub mod surface;
pub mod vdf;

pub use absorb::{
    absorb_owned, absorb_packs, scan_absorb_delta, write_config_cfg_dual, AbsorbDelta,
    AbsorbOwnedResult, PackChoice,
};
pub use finder::{
    discover_steam_roots, normalize_tf2_root, scan_tf2_installs, scan_tf2_installs_in, Tf2Install,
    Tf2RootError,
};
pub use process_lock::{
    is_tf2_running, refuse_if_running, refuse_if_running_among, write_lock_status, WriteLock,
    WriteLockError,
};
pub use profile::{
    create_profile_record, init_library, load_library, profiles_dir, save_current_as, ProfileError,
    ProfileLibrary, ProfileSummary,
};
pub use settings::{
    remember_tf2_root, remember_tf2_root_to, remembered_tf2_root, remembered_tf2_root_from,
    settings_file, Settings,
};
pub use surface::{inventory_live_surface, CfgLayer, LiveInventory};

#[cfg(test)]
pub(crate) fn test_temp_dir() -> std::path::PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let dir = std::env::temp_dir().join(format!(
        "execs-core-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}
