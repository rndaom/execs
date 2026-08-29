mod commands;

use std::time::Duration;

use tauri::{AppHandle, Emitter};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
