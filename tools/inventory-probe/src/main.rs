fn main() {
    let mut args = std::env::args_os().skip(1);
    let Some(path) = args.next() else {
        println!("Usage: execs-inventory-probe <absolute path to installed Steam API library>");
        return;
    };
    if path == "--inventory-operation" {
        if let Some(library) = args.next() {
            execs_inventory_probe::operation_helper(std::path::Path::new(&library));
        }
        return;
    }
    execs_inventory_probe::helper(std::path::Path::new(&path));
}
