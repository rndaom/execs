pub mod absorb;
pub mod apply;
pub mod blob;
pub mod cfg_script;
pub mod comfig;
pub mod crosshair;
pub mod finder;
pub mod first_run;
pub mod hash;
pub mod hitsound;
pub mod hud;
pub mod hud_apply;
pub mod ice;
pub mod launch;
pub mod mdl;
pub mod pcf;
pub mod preloader;
pub mod process_lock;
pub mod profile;
pub mod settings;
pub mod steam_inf;
pub mod surface;
pub mod switch;
pub mod vdf;
pub mod viewmodel;
pub mod viewmodel_build;
pub mod viewmodel_groups;
pub mod vpk;
pub mod vtf_read;
pub mod wizard;
pub mod zip;

pub use absorb::{
    absorb_owned, absorb_packs, scan_absorb_delta, write_config_cfg_dual, AbsorbDelta,
    AbsorbOwnedResult, PackChoice,
};
pub use apply::{
    get_active_profile_detail, list_profile_files, profile_file_bytes_from, read_profile_file,
    write_owned_file, ProfileDetail, ProfileFileContent,
};
pub use comfig::{
    apply_official_vpk_bytes, apply_official_vpk_bytes_to, import_comfig_custom,
    import_comfig_custom_to, official_download_urls, official_package_rel_paths, parse_modules_cfg,
    parse_setup_hook, read_active_comfig_state, read_active_comfig_state_from, read_comfig_state,
    read_comfig_state_from, serialize_modules_cfg, serialize_setup_hook, set_comfig_addons,
    set_comfig_addons_to, write_comfig_modules, write_comfig_modules_to, write_comfig_preset,
    write_comfig_preset_to, ComfigState,
};
pub use crosshair::{
    apply_crosshairs, extract_stock_crosshair_sprites, remove_crosshairs, stored_pack_crosshair,
    CrosshairAsset, CrosshairAssetFormat, StockCrosshairSprite,
};
pub use finder::{
    discover_steam_roots, normalize_tf2_root, scan_tf2_installs, scan_tf2_installs_in, Tf2Install,
    Tf2RootError,
};
pub use first_run::{classify_first_run, FirstRunClass, FirstRunKind};
pub use hitsound::{
    apply_hitsounds, extract_stock_hitsounds, inspect_wav, prepare_hitsound_wav, remove_hitsounds,
    stored_hitsound, HitsoundChange, HitsoundEntry, HitsoundKind, HitsoundRecord, HitsoundSource,
    WavInfo, EXECS_HITSOUNDS_PACK, STOCK_HITSOUND_EFFECTS,
};
pub use hud::{
    apply_schema_options, apply_schema_options_to, catalog_cache_dir, catalog_entry_from_json,
    extract_hud_archive, extract_hud_zip, hud_ui_state, hud_zip_url, install_hud_pack,
    load_catalog_cache_from, load_hud_tree_from_profile, match_hud_catalog, resolve_hud,
    save_catalog_cache_to, schema_file_name, schema_supported, set_hud_options,
    sync_hud_exec_lines, sync_hud_exec_lines_to, write_hud_tree_files, HudCatalogCache,
    HudCatalogEntry, HudInstallKind, HudStatus, HudTree, HudUiState, SUPPORTED_SCHEMA_HUDS,
};
pub use hud_apply::{
    apply_hud_options, apply_hud_options_for_layer, hud_cfg_path, hud_cfg_stem, parse_hud_schema,
    schema_view, HudSchema, HudSchemaView, HUD_CFG_PREFIX,
};
pub use launch::{
    get_profile_launch_options, recommended_launch_options, set_profile_launch_options,
    LaunchWriteReason, SetLaunchResult,
};
pub use process_lock::{
    is_steam_running, is_tf2_running, refuse_if_running, refuse_if_running_among,
    write_lock_status, WriteLock, WriteLockError,
};
pub use profile::{
    create_profile_record, init_library, load_library, load_manifest, profiles_dir,
    save_current_as, CrosshairRecord, HudRecord, HudSource, ProfileError, ProfileFile,
    ProfileLibrary, ProfileSummary, ViewmodelRecord, ViewmodelSource,
};
pub use settings::{
    execs_data_dir, remember_tf2_root, remember_tf2_root_to, remembered_tf2_root,
    remembered_tf2_root_from, settings_file, Settings,
};
pub use surface::{inventory_live_surface, CfgLayer, LiveInventory};
pub use switch::{switch_profile, switch_profile_with_progress, SwitchProgress, SwitchStep};
pub use viewmodel::{
    ensure_profile_preload, import_viewmodel_vpk, install_built_viewmodel_pack,
    remove_profile_preload_if_unused, remove_viewmodels, set_viewmodel_preload,
};
pub use viewmodel_build::{build_viewmodel_pack_vpk, studiomdl_file_name, ViewmodelHideMode};
pub use viewmodel_groups::{ViewmodelGroup, VIEWMODEL_GROUPS};
pub use wizard::{
    download_urls_for_spec, materialize_wizard_profile, required_wizard_assets, ComfigPreset,
    GitHubAsset, GitHubRelease, OfficialAddon, StartFrom, WizardAsset, WizardResult, WizardSpec,
};
pub use zip::{
    export_profile, export_profile_to, import_profile, import_profile_from, safe_zip_file_name,
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
