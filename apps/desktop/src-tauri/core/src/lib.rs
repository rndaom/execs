pub mod finder;
pub mod process_lock;
pub mod settings;
pub mod steam_inf;
pub mod vdf;

pub use finder::{
    discover_steam_roots, normalize_tf2_root, scan_tf2_installs, scan_tf2_installs_in, Tf2Install,
    Tf2RootError,
};
pub use process_lock::{
    is_tf2_running, refuse_if_running, refuse_if_running_among, write_lock_status, WriteLock,
    WriteLockError,
};
pub use settings::{
    remember_tf2_root, remember_tf2_root_to, remembered_tf2_root, remembered_tf2_root_from,
    settings_file, Settings,
};

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
