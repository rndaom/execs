//! Read-only check of local item names and artwork; no Steam connection.
fn main() {
    let root = std::env::args_os().nth(1).expect("TF2 root required");
    let root = std::path::Path::new(&root);
    let definitions = execs_core::inventory::definitions(root, &[13, 5002].into_iter().collect())
        .expect("item definitions");
    let paths: Vec<_> = definitions
        .values()
        .filter_map(|d| d.icon.clone())
        .collect();
    let icons = execs_core::inventory::icons(root, &paths).expect("base artwork");
    println!(
        "{} definitions, {} decoded icons",
        definitions.len(),
        icons.len()
    );
    for (id, definition) in definitions {
        println!(
            "{id}: {} ({})",
            definition.name,
            definition.icon.as_deref().unwrap_or("no icon")
        );
    }
}
