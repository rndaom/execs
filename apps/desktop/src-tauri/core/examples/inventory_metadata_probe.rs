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
    // Synthetic identities exercise installed variant metadata without reading a
    // player's inventory or publishing account/item identifiers.
    let variants = execs_core::inventory::metadata(
        root,
        &[
            execs_core::inventory::ItemInput {
                id: "paint-example",
                definition: 17286,
                attributes: Vec::new(),
            },
            execs_core::inventory::ItemInput {
                id: "kit-example",
                definition: 6527,
                attributes: vec![(2012, &18f32.to_le_bytes()), (2025, &3f32.to_le_bytes())],
            },
        ],
    )
    .expect("variant descriptions");
    let variant_paths: Vec<_> = variants
        .item_descriptions
        .values()
        .filter_map(|description| description.definition.icon.clone())
        .collect();
    let variant_icons =
        execs_core::inventory::icons(root, &variant_paths).expect("variant artwork");
    println!("{} variant images decoded", variant_icons.len());
    assert!(
        variants.item_descriptions["paint-example"]
            .definition
            .icon
            .as_ref()
            .is_some_and(|path| variant_icons.contains_key(path)),
        "installed paint swatch must decode"
    );
    for description in variants.item_descriptions.values() {
        println!(
            "Variant: {} ({:?})",
            description.definition.name, description.details
        );
    }
}
