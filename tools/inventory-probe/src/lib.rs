mod native;
mod protocol;

pub use native::read_inventory;
pub use protocol::{InventoryItem, Snapshot};

/// Called only in a dedicated process, before Tauri or any worker is initialized.
pub fn helper(path: &std::path::Path) {
    let result = read_inventory(path).map_err(|e| e.to_string());
    // Steam itself may write diagnostics to stdout. The parent accepts only this
    // bounded, distinctly prefixed JSON record, never arbitrary SDK output.
    println!(
        "EXECS_INVENTORY:{}",
        serde_json::to_string(&result).expect("serializable snapshot")
    );
}
