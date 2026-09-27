mod native;
mod operation;
mod operation_wire;
mod protocol;

pub use native::{operate_inventory, read_inventory};
pub use operation::{
    reconcile_operation, same_inventory, Operation, OperationMove, OperationRequest,
    OperationResult, OperationStatus,
};
pub use operation_wire::MAX_POSITION_MOVES;
pub use protocol::{EquippedState, InventoryItem, ItemAttribute, Snapshot};

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

/// Parent persists the reviewed operation intent before spawning this single-use helper.
/// No mutation request is accepted via command-line arguments or SDK callback text.
pub fn operation_helper(path: &std::path::Path) {
    use std::io::Read;
    let result = (|| -> Result<OperationResult, String> {
        let mut bytes = Vec::new();
        std::io::stdin()
            .lock()
            .take(32 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 32 * 1024 * 1024 {
            return Err("Operation request exceeds limit".into());
        }
        let request = serde_json::from_slice(&bytes)
            .map_err(|e| format!("Invalid operation request: {e}"))?;
        Ok(operate_inventory(path, request))
    })();
    println!(
        "EXECS_INVENTORY_OPERATION:{}",
        serde_json::to_string(&result).expect("serializable operation result")
    );
}
