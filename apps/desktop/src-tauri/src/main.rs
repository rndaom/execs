// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args_os().nth(1).as_deref() == Some(std::ffi::OsStr::new("--inventory-read")) {
        if cfg!(debug_assertions) {
            if let Some(path) = std::env::args_os().nth(2) {
                execs_inventory_probe::helper(std::path::Path::new(&path));
            }
        }
        return;
    }
    execs_lib::run()
}
