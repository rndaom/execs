//! Read-only class bone hierarchy coverage on an installed TF2 copy.
//! Usage: cargo run --example viewmodel_bones_probe --features probes -- <tf2-root>

use std::path::Path;

use execs_core::viewmodel_source::read_stock_bone_index;

fn is_weapon_bone(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.starts_with("weapon_bone") || name.starts_with("vm_weapon_bone")
}

fn main() {
    let root = std::env::args()
        .nth(1)
        .expect("provide the confirmed TF2 root");
    let index = read_stock_bone_index(Path::new(&root)).expect("stock bone index");
    println!(
        "TF2 patch {}, {} class animation models",
        index.patch_version,
        index.models.len()
    );
    for (class, model) in &index.models {
        let weapons: Vec<_> = model
            .bones
            .iter()
            .enumerate()
            .filter(|(_, bone)| is_weapon_bone(&bone.name))
            .collect();
        let direct_hand_children = weapons
            .iter()
            .filter(|(_, bone)| {
                bone.parent.is_some_and(|parent| {
                    matches!(
                        model.bones[parent].name.as_str(),
                        "bip_hand_L" | "bip_hand_R"
                    )
                })
            })
            .count();
        let unusual_parents: Vec<_> = weapons
            .iter()
            .filter(|(_, bone)| {
                !bone.parent.is_some_and(|parent| {
                    matches!(
                        model.bones[parent].name.as_str(),
                        "bip_hand_L" | "bip_hand_R"
                    )
                })
            })
            .map(|(_, bone)| bone.name.as_str())
            .collect();
        println!(
            "{class}: {} bones, {} weapon-named bones, {} direct hand children, other parents {:?}",
            model.bones.len(),
            weapons.len(),
            direct_hand_children,
            unusual_parents
        );
    }
}
