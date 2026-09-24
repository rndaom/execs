//! Read-only script-role coverage on an installed TF2 copy.
//! Usage: cargo run --example viewmodel_scripts_probe --features probes -- <tf2-root>

use std::collections::BTreeMap;
use std::path::Path;

use execs_core::viewmodel_items::read_stock_item_catalog;
use execs_core::viewmodel_scripts::{
    read_stock_weapon_scripts, resolve_item_role, resolve_item_role_for_class, ItemRoleSource,
};

fn main() {
    let root = std::env::args()
        .nth(1)
        .expect("provide the confirmed TF2 root");
    let root = Path::new(&root);
    let items = read_stock_item_catalog(root).expect("stock item catalog");
    let scripts = read_stock_weapon_scripts(root).expect("stock weapon scripts");
    assert_eq!(
        items.patch_version, scripts.patch_version,
        "TF2 patch changed"
    );
    let weapon_items: Vec<_> = items
        .items
        .values()
        .filter(|item| item.item_class.starts_with("tf_weapon_"))
        .collect();
    let mut item_override = 0;
    let mut unsupported_override = 0;
    let mut script_role = 0;
    let mut default_role = 0;
    let mut unresolved = 0;
    let mut unsupported_type = 0;
    let mut override_slots = BTreeMap::new();
    let mut missing_scripts: BTreeMap<&str, Vec<u32>> = BTreeMap::new();
    let mut special_overrides: BTreeMap<&str, Vec<u32>> = BTreeMap::new();
    for item in &weapon_items {
        if let Some(slot) = &item.animation_slot {
            *override_slots.entry(slot.as_str()).or_insert(0usize) += 1;
        }
        let resolved = resolve_item_role(item, &scripts);
        match resolved.source {
            ItemRoleSource::ItemOverride => item_override += 1,
            ItemRoleSource::UnsupportedItemOverride => {
                unsupported_override += 1;
                special_overrides
                    .entry(item.animation_slot.as_deref().unwrap_or(""))
                    .or_default()
                    .push(item.id);
            }
            ItemRoleSource::WeaponScript => script_role += 1,
            ItemRoleSource::WeaponScriptDefault => default_role += 1,
            ItemRoleSource::ShotgunClassCandidate => unreachable!("classless resolver"),
            ItemRoleSource::Unresolved if resolved.script_path.is_some() => unsupported_type += 1,
            ItemRoleSource::Unresolved => {
                unresolved += 1;
                missing_scripts
                    .entry(&item.item_class)
                    .or_default()
                    .push(item.id);
            }
        }
    }
    println!(
        "TF2 patch {}, {} decoded scripts",
        scripts.patch_version,
        scripts.scripts.len()
    );
    println!(
        "{} weapon-class items: {} item overrides, {} unsupported item overrides, {} script roles, {} script defaults, {} missing exact scripts, {} unsupported script types",
        weapon_items.len(), item_override, unsupported_override, script_role, default_role, unresolved, unsupported_type
    );
    println!("item override slots: {override_slots:?}");
    println!("unsupported item overrides: {special_overrides:?}");
    println!("missing exact scripts: {missing_scripts:?}");
    let shotgun_scripts: Vec<_> = scripts
        .scripts
        .keys()
        .filter(|stem| stem.starts_with("tf_weapon_shotgun"))
        .collect();
    println!("installed shotgun script stems: {shotgun_scripts:?}");
    let mut class_candidates = BTreeMap::new();
    let mut class_unresolved = BTreeMap::new();
    for item in &weapon_items {
        for class in &item.classes {
            let role = resolve_item_role_for_class(item, class, &scripts);
            match role.source {
                ItemRoleSource::ShotgunClassCandidate => {
                    *class_candidates.entry(class.as_str()).or_insert(0usize) += 1;
                }
                ItemRoleSource::Unresolved => {
                    class_unresolved
                        .entry((item.id, class.as_str()))
                        .or_insert(role.script_path);
                }
                _ => {}
            }
        }
    }
    println!("class-specific shotgun candidates: {class_candidates:?}");
    println!("unresolved item/class roles: {class_unresolved:?}");
}
