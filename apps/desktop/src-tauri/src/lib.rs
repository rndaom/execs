mod comfig_fetch;
mod commands;
mod crosshair_fetch;
mod error;
mod hud_fetch;
mod mods_fetch;
mod net;
mod viewmodel_fetch;

use std::io::Write;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

/// Serializes every command that writes the profile library or the live
/// surface. Without it the auto-absorb path (fired from an effect when TF2
/// quits) races the settings panes: both read `profiles/index.json`, both
/// mutate it, and the last writer silently drops the other's changes.
///
/// `tokio::sync::Mutex`, not `std`: the guard is held across `.await`.
pub struct WriteGate(pub tokio::sync::Mutex<()>);

/// Log panics to %AppData%\execs\logs\panic.log (or the Linux data dir) so a
/// crash leaves a trace even when no console is attached.
fn install_panic_logger() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let settings = execs_core::settings_file();
        if let Some(dir) = settings.parent() {
            let logs = dir.join("logs");
            let _ = std::fs::create_dir_all(&logs);
            if let Ok(mut file) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(logs.join("panic.log"))
            {
                let location = info
                    .location()
                    .map(|loc| format!("{}:{}", loc.file(), loc.line()))
                    .unwrap_or_else(|| "unknown".into());
                let _ = writeln!(file, "[{}] panic at {location}: {info}", timestamp());
            }
        }
        previous(info);
    }));
}

fn timestamp() -> String {
    match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
        Ok(elapsed) => format!("unix {}", elapsed.as_secs()),
        Err(_) => "unknown time".into(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_logger();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::finder::scan_tf2_installs,
            commands::finder::browse_tf2_root,
            commands::finder::confirm_tf2_root,
            commands::finder::get_tf2_root,
            commands::finder::tf2_write_lock,
            commands::library::get_profile_library,
            commands::library::init_profile_library,
            commands::library::save_current_as,
            commands::library::switch_profile,
            commands::library::export_profile,
            commands::library::import_profile,
            commands::absorb::absorb_owned,
            commands::absorb::absorb_packs,
            commands::first_run::classify_first_run,
            commands::first_run::apply_unused_wizard,
            commands::first_run::get_inherit_binds,
            commands::first_run::set_inherit_binds,
            commands::first_run::create_fresh_profile,
            commands::files::get_active_profile_detail,
            commands::files::read_profile_file,
            commands::files::write_owned_file,
            commands::comfig::get_comfig_state,
            commands::comfig::set_comfig_preset,
            commands::comfig::set_comfig_modules,
            commands::comfig::set_comfig_addons,
            commands::comfig::update_comfig_vpks,
            commands::comfig::import_comfig_custom,
            commands::launch::recommended_launch_options,
            commands::launch::get_profile_launch_options,
            commands::launch::set_profile_launch_options,
            commands::hud::get_hud_catalog,
            commands::hud::get_hud_state,
            commands::hud::install_hud,
            commands::hud::match_hud_catalog,
            commands::hud::update_hud,
            commands::hud::get_hud_schema,
            commands::hud::apply_hud_options,
            commands::crosshair::apply_crosshairs,
            commands::crosshair::fetch_community_crosshair,
            commands::crosshair::get_pack_crosshair_previews,
            commands::crosshair::get_stock_crosshair_sprites,
            commands::crosshair::remove_crosshairs,
            commands::viewmodel::build_viewmodel_pack,
            commands::viewmodel::import_viewmodels,
            commands::viewmodel::remove_viewmodels,
            commands::viewmodel::set_viewmodel_preload,
            commands::viewmodel::viewmodel_build_available,
            commands::open_embedded_page,
            commands::preloader::get_preloader_status,
            commands::preloader::get_default_mods,
            commands::preloader::download_default_mods,
            commands::preloader::apply_preloader_mods,
            commands::preloader::set_gameinfo_bypass,
            commands::preloader::revert_preloader,
        ])
        .setup(|app| {
            app.manage(WriteGate(tokio::sync::Mutex::new(())));
            spawn_lock_poller(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running execs");
}

fn spawn_lock_poller(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last = None;
        loop {
            // A failed poll must never take the app down; skip the tick instead.
            let running = std::panic::catch_unwind(execs_core::is_tf2_running);
            if let Ok(running) = running {
                if last != Some(running) {
                    let _ = app.emit("tf2-running", running);
                    last = Some(running);
                }
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}
