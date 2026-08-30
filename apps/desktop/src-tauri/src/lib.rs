mod comfig_fetch;
mod commands;
mod hud_fetch;

use std::time::Duration;

use tauri::{AppHandle, Emitter};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::scan_tf2_installs,
            commands::validate_tf2_root,
            commands::browse_tf2_root,
            commands::confirm_tf2_root,
            commands::get_tf2_root,
            commands::tf2_write_lock,
            commands::get_profile_library,
            commands::init_profile_library,
            commands::create_profile_record,
            commands::save_current_as,
            commands::scan_absorb_delta,
            commands::absorb_owned,
            commands::absorb_packs,
            commands::switch_profile,
            commands::export_profile,
            commands::import_profile,
            commands::classify_first_run,
            commands::apply_unused_wizard,
            commands::get_inherit_binds,
            commands::set_inherit_binds,
            commands::create_fresh_profile,
            commands::get_active_profile_detail,
            commands::list_profile_files,
            commands::read_profile_file,
            commands::write_owned_file,
            commands::get_comfig_state,
            commands::set_comfig_preset,
            commands::set_comfig_modules,
            commands::set_comfig_addons,
            commands::update_comfig_vpks,
            commands::import_comfig_custom,
            commands::recommended_launch_options,
            commands::get_profile_launch_options,
            commands::set_profile_launch_options,
            commands::get_hud_catalog,
            commands::get_hud_state,
            commands::install_hud,
            commands::match_hud_catalog,
            commands::update_hud,
            commands::get_hud_schema,
            commands::apply_hud_options,
            commands::apply_crosshairs,
            commands::remove_crosshairs,
            commands::compile_viewmodels,
            commands::import_viewmodels,
            commands::remove_viewmodels,
            commands::set_viewmodel_preload,
        ])
        .setup(|app| {
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
            let running = execs_core::is_tf2_running();
            if last != Some(running) {
                let _ = app.emit("tf2-running", running);
                last = Some(running);
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}
