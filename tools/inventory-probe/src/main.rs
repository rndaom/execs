fn main() {
    let Some(path) = std::env::args_os().nth(1) else {
        println!("Usage: execs-inventory-probe <absolute path to installed Steam API library>");
        return;
    };
    execs_inventory_probe::helper(std::path::Path::new(&path));
}
