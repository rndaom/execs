//! Read-only, provisional group selection to in-memory Viewmodels VPK.
//!
//! This path does not install the candidate or establish retail reachability.
//! The installed-source wrapper rechecks every source it read before returning.

use std::collections::BTreeMap;
use std::path::Path;

use crate::finder::normalize_tf2_root;
use crate::hash::sha256_hex;
use crate::viewmodel_graph::candidate_activity_graph;
use crate::viewmodel_group_selection::{
    resolve_provisional_group_selection, ProvisionalGroupCatalogIdentity, ProvisionalGroupRequest,
};
use crate::viewmodel_groups::{derive_group_candidates, ViewmodelGroupCandidates};
use crate::viewmodel_items::read_stock_item_catalog;
use crate::viewmodel_scripts::{read_stock_weapon_scripts, StockWeaponScriptIndex};
use crate::viewmodel_source::{
    read_stock_animation_index, read_stock_bone_index, StockAnimationIndex, StockBoneIndex,
    StockSourceError,
};
use crate::viewmodel_vpk_candidate::{prototype_viewmodel_vpk, VerifiedClassModel};
use crate::vpk::{crc32, map_vpk_entries, read_vpk_entry};

const MAX_STOCK_MDL_BYTES: usize = 8 * 1024 * 1024;

fn invalid(message: impl Into<String>) -> StockSourceError {
    StockSourceError(message.into())
}

fn model_key(class: &str) -> &str {
    if class == "demoman" {
        "demo"
    } else {
        class
    }
}

fn canonical_weapon_script_fingerprints(
    scripts: &StockWeaponScriptIndex,
) -> Result<BTreeMap<String, String>, StockSourceError> {
    let mut fingerprints = BTreeMap::new();
    for script in scripts.scripts.values() {
        // VPK member paths use '/' already. Recipe source IDs use the same
        // portable lowercase spelling as catalog IDs, while the digest still
        // names the exact installed bytes.
        let id = script.path.to_ascii_lowercase();
        if fingerprints
            .insert(id.clone(), script.sha256.clone())
            .is_some()
        {
            return Err(invalid(format!(
                "Viewmodels weapon scripts collide under portable case: {id}"
            )));
        }
    }
    Ok(fingerprints)
}

/// Exact source digests inspected to form the catalog and the candidate.
/// A later install transaction must re-read these sources under its write
/// gate before publishing the VPK; this struct does not authorize a write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstalledViewmodelSourceFingerprints {
    pub patch_version: String,
    pub item_schema_sha256: String,
    pub weapon_script_sha256: BTreeMap<String, String>,
    pub class_model_sha256: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstalledGroupVpkCandidate {
    pub vpk_bytes: Vec<u8>,
    pub catalog: ProvisionalGroupCatalogIdentity,
    pub sources: InstalledViewmodelSourceFingerprints,
}

/// Resolve a request made from this exact provisional catalog and compose
/// selected class MDLs whose bytes match both verified installed indexes.
/// The catalog, indexes and bytes must be read from one confirmed TF2 install;
/// `prototype_selected_group_vpk_from_install` supplies that read-only path.
pub fn prototype_selected_group_vpk(
    catalog: &ViewmodelGroupCandidates,
    request: &ProvisionalGroupRequest,
    animations: &StockAnimationIndex,
    bones: &StockBoneIndex,
    model_bytes: &BTreeMap<String, Vec<u8>>,
) -> Result<Vec<u8>, StockSourceError> {
    let selections = resolve_provisional_group_selection(catalog, request)?;
    if catalog.patch_version != animations.patch_version
        || catalog.patch_version != bones.patch_version
    {
        return Err(invalid(
            "provisional Viewmodels catalog and class indexes come from different TF2 patches",
        ));
    }
    let mut verified = BTreeMap::new();
    for class in selections.keys() {
        let key = model_key(class);
        let bytes = model_bytes
            .get(key)
            .ok_or_else(|| invalid(format!("verified class model {class} bytes are missing")))?;
        let animation = animations
            .models
            .get(key)
            .ok_or_else(|| invalid(format!("verified class animation index {class} is missing")))?;
        let bone = bones
            .models
            .get(key)
            .ok_or_else(|| invalid(format!("verified class bone index {class} is missing")))?;
        let fingerprint = sha256_hex(bytes);
        if fingerprint != animation.sha256 || fingerprint != bone.sha256 {
            return Err(invalid(format!(
                "class {class} model bytes differ from their verified installed indexes"
            )));
        }
        verified.insert(
            key.to_string(),
            VerifiedClassModel {
                bytes,
                animations: animation,
                bones: bone,
            },
        );
    }
    prototype_viewmodel_vpk(&verified, &selections)
}

/// Read only the user's confirmed app-440 install and return a VPK candidate
/// in memory. All inputs to the provisional catalog and each selected model
/// are reread after composition; a changed source refuses the candidate.
pub fn prototype_selected_group_vpk_from_install(
    tf2_root: &Path,
    request: &ProvisionalGroupRequest,
) -> Result<InstalledGroupVpkCandidate, StockSourceError> {
    let items = read_stock_item_catalog(tf2_root)?;
    let scripts = read_stock_weapon_scripts(tf2_root)?;
    let animations = read_stock_animation_index(tf2_root)?;
    let bones = read_stock_bone_index(tf2_root)?;
    let graph = candidate_activity_graph(&items, &scripts, &animations)?;
    let catalog = derive_group_candidates(&graph)?;
    let selections = resolve_provisional_group_selection(&catalog, request)?;
    if bones.patch_version != catalog.patch_version {
        return Err(invalid(
            "provisional Viewmodels catalog and class indexes come from different TF2 patches",
        ));
    }
    let mut source_models = BTreeMap::new();
    for (class, model) in &animations.models {
        if bones.models.get(class).map(|bone| bone.sha256.as_str()) != Some(&model.sha256) {
            return Err(invalid(format!(
                "class {class} animation and bone indexes differ"
            )));
        }
        source_models.insert(class.clone(), model.sha256.clone());
    }
    if source_models.len() != bones.models.len() {
        return Err(invalid("class animation and bone indexes differ"));
    }
    let sources = InstalledViewmodelSourceFingerprints {
        patch_version: catalog.patch_version.clone(),
        item_schema_sha256: items.schema_sha256.clone(),
        weapon_script_sha256: canonical_weapon_script_fingerprints(&scripts)?,
        class_model_sha256: source_models,
    };
    let root = normalize_tf2_root(tf2_root).map_err(|error| invalid(error.message()))?;
    let vpk = root.join("tf/tf2_misc_dir.vpk");
    let entries = map_vpk_entries(&vpk)
        .map_err(|error| invalid(format!("Could not map tf2_misc VPK: {}", error.0)))?;
    let mut selected_entries = BTreeMap::new();
    let mut model_bytes = BTreeMap::new();
    for class in selections.keys() {
        let key = model_key(class);
        let path = format!("models/weapons/c_models/c_{key}_animations.mdl");
        let entry = entries
            .get(&path)
            .ok_or_else(|| invalid(format!("TF2 stock model {path} is missing")))?;
        if entry.total_len() > MAX_STOCK_MDL_BYTES {
            return Err(invalid(format!("TF2 stock model {path} exceeds 8 MiB")));
        }
        let bytes = read_vpk_entry(&vpk, entry)
            .map_err(|error| invalid(format!("Could not read {path}: {}", error.0)))?;
        if crc32(&bytes) != entry.crc {
            return Err(invalid(format!(
                "TF2 stock model {path} differs from its VPK CRC"
            )));
        }
        selected_entries.insert(path, entry.clone());
        model_bytes.insert(key.to_string(), bytes);
    }
    let packed =
        prototype_selected_group_vpk(&catalog, request, &animations, &bones, &model_bytes)?;
    if read_stock_item_catalog(tf2_root)? != items
        || read_stock_weapon_scripts(tf2_root)? != scripts
        || read_stock_animation_index(tf2_root)? != animations
        || read_stock_bone_index(tf2_root)? != bones
    {
        return Err(invalid(
            "TF2 Viewmodels sources changed during candidate composition",
        ));
    }
    let updated_entries = map_vpk_entries(&vpk)
        .map_err(|error| invalid(format!("Could not recheck tf2_misc VPK: {}", error.0)))?;
    for (path, original) in selected_entries {
        let entry = updated_entries
            .get(&path)
            .ok_or_else(|| invalid(format!("TF2 stock model {path} disappeared")))?;
        if entry.total_len() > MAX_STOCK_MDL_BYTES {
            return Err(invalid(format!("TF2 stock model {path} exceeds 8 MiB")));
        }
        let bytes = read_vpk_entry(&vpk, entry)
            .map_err(|error| invalid(format!("Could not recheck {path}: {}", error.0)))?;
        let key = path
            .strip_prefix("models/weapons/c_models/c_")
            .and_then(|name| name.strip_suffix("_animations.mdl"))
            .ok_or_else(|| invalid("selected stock model path is invalid"))?;
        if entry != &original
            || crc32(&bytes) != entry.crc
            || model_bytes.get(key).map(|source| sha256_hex(source)) != Some(sha256_hex(&bytes))
        {
            return Err(invalid(format!(
                "TF2 stock model {path} changed during candidate composition"
            )));
        }
    }
    Ok(InstalledGroupVpkCandidate {
        vpk_bytes: packed,
        catalog: request.catalog.clone(),
        sources,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::viewmodel_group_selection::{
        provisional_group_catalog_identity, ProvisionalGroupChoice, ProvisionalHideMode,
    };
    use crate::viewmodel_groups::{group_id, ViewmodelGroupCandidate};
    use crate::viewmodel_pose::parse_stock_pose_mdl;
    use crate::viewmodel_scripts::StockWeaponScript;
    use crate::viewmodel_source::{parse_stock_animation_mdl, parse_stock_bone_mdl};
    use crate::vpk::read_vpk_dir_bytes;

    const HEADER: usize = 408;
    const BONE: usize = 216;
    const ANIMATION: usize = 100;
    const SEQUENCE: usize = 212;

    fn write_i32(bytes: &mut [u8], at: usize, value: i32) {
        bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
    }

    fn append_name(bytes: &mut Vec<u8>, base: usize, name: &str) -> i32 {
        let offset = (bytes.len() - base) as i32;
        bytes.extend_from_slice(name.as_bytes());
        bytes.push(0);
        offset
    }

    fn fixture() -> Vec<u8> {
        let bone_table = HEADER;
        let animation_table = bone_table + 3 * BONE;
        let sequence = animation_table + 2 * ANIMATION;
        let mut bytes = vec![0; sequence + SEQUENCE];
        bytes[..4].copy_from_slice(b"IDST");
        let name = b"weapons/c_models/c_scout_animations.mdl";
        bytes[12..12 + name.len()].copy_from_slice(name);
        write_i32(&mut bytes, 4, 48);
        write_i32(&mut bytes, 156, 3);
        write_i32(&mut bytes, 160, bone_table as i32);
        write_i32(&mut bytes, 180, 2);
        write_i32(&mut bytes, 184, animation_table as i32);
        write_i32(&mut bytes, 188, 1);
        write_i32(&mut bytes, 192, sequence as i32);
        for (index, (name, parent)) in [("root", -1), ("bip_hand_R", 0), ("weapon_bone", 1)]
            .into_iter()
            .enumerate()
        {
            let base = bone_table + index * BONE;
            let offset = append_name(&mut bytes, base, name);
            write_i32(&mut bytes, base, offset);
            write_i32(&mut bytes, base + 4, parent);
        }
        for (index, name) in ["@full", "@weapon"].into_iter().enumerate() {
            let base = animation_table + index * ANIMATION;
            let offset = append_name(&mut bytes, base, name);
            write_i32(&mut bytes, base, -(base as i32));
            write_i32(&mut bytes, base + 4, offset);
            bytes[base + 8..base + 12].copy_from_slice(&30f32.to_le_bytes());
            write_i32(&mut bytes, base + 16, 3);
        }
        write_i32(&mut bytes, sequence, -(sequence as i32));
        let seq_name = append_name(&mut bytes, sequence, "draw");
        let seq_activity = append_name(&mut bytes, sequence, "ACT_VM_DRAW");
        let grid = bytes.len() - sequence;
        bytes.extend_from_slice(&0i16.to_le_bytes());
        write_i32(&mut bytes, sequence + 4, seq_name);
        write_i32(&mut bytes, sequence + 8, seq_activity);
        write_i32(&mut bytes, sequence + 56, 1);
        write_i32(&mut bytes, sequence + 60, grid as i32);
        write_i32(&mut bytes, sequence + 68, 1);
        write_i32(&mut bytes, sequence + 72, 1);
        for index in 0..2 {
            let base = animation_table + index * ANIMATION;
            let chain = bytes.len();
            bytes.extend_from_slice(&[0, 0x01, 10, 0, 0, 0, 0, 0, 0, 0]);
            bytes.extend_from_slice(&[2, 0x20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            write_i32(&mut bytes, base + 56, (chain - base) as i32);
        }
        let length = bytes.len() as i32;
        write_i32(&mut bytes, 76, length);
        bytes
    }

    fn fixture_catalog() -> ViewmodelGroupCandidates {
        ViewmodelGroupCandidates {
            patch_version: "fixture".into(),
            groups: ["@full", "@weapon"]
                .into_iter()
                .enumerate()
                .map(|(index, animation)| {
                    let animations = vec![animation.to_string()];
                    ViewmodelGroupCandidate {
                        id: group_id("scout", &animations),
                        class: "scout".into(),
                        item_ids: vec![(index + 1) as u32],
                        animations,
                        overlaps: Vec::new(),
                        team_variants_differ: false,
                    }
                })
                .collect(),
            unresolved_items: Vec::new(),
        }
    }

    fn fixture_request(catalog: &ViewmodelGroupCandidates) -> ProvisionalGroupRequest {
        ProvisionalGroupRequest {
            catalog: provisional_group_catalog_identity(catalog).unwrap(),
            choices: vec![
                ProvisionalGroupChoice {
                    group_id: catalog.groups[0].id.clone(),
                    mode: ProvisionalHideMode::Full,
                },
                ProvisionalGroupChoice {
                    group_id: catalog.groups[1].id.clone(),
                    mode: ProvisionalHideMode::Weapon,
                },
            ],
        }
    }

    #[test]
    fn weapon_script_source_ids_fold_case_without_overwriting_collisions() {
        let mut scripts = StockWeaponScriptIndex {
            patch_version: "fixture".into(),
            scripts: BTreeMap::from([
                (
                    "scout_pistol".into(),
                    StockWeaponScript {
                        path: "Scripts/TF_Weapon_Scout_Pistol.CTX".into(),
                        sha256: "a".repeat(64),
                        weapon_type: Some("SECONDARY".into()),
                    },
                ),
                (
                    "scattergun".into(),
                    StockWeaponScript {
                        path: "scripts/tf_weapon_scattergun.ctx".into(),
                        sha256: "b".repeat(64),
                        weapon_type: Some("PRIMARY".into()),
                    },
                ),
            ]),
        };
        let fingerprints = canonical_weapon_script_fingerprints(&scripts).unwrap();
        assert_eq!(
            fingerprints["scripts/tf_weapon_scout_pistol.ctx"],
            "a".repeat(64)
        );
        assert_eq!(fingerprints.len(), 2);
        scripts.scripts.insert(
            "colliding_second_stem".into(),
            StockWeaponScript {
                path: "scripts/tf_weapon_scout_pistol.ctx".into(),
                sha256: "c".repeat(64),
                weapon_type: None,
            },
        );
        assert!(canonical_weapon_script_fingerprints(&scripts)
            .unwrap_err()
            .0
            .contains("collide under portable case"));
    }

    #[test]
    fn selected_groups_compose_both_modes_in_one_exact_vpk_member() {
        let bytes = fixture();
        let animation = parse_stock_animation_mdl(&bytes).unwrap();
        let bone = parse_stock_bone_mdl(&bytes).unwrap();
        let catalog = fixture_catalog();
        let packed = prototype_selected_group_vpk(
            &catalog,
            &fixture_request(&catalog),
            &StockAnimationIndex {
                patch_version: "fixture".into(),
                models: BTreeMap::from([("scout".into(), animation.clone())]),
            },
            &StockBoneIndex {
                patch_version: "fixture".into(),
                models: BTreeMap::from([("scout".into(), bone.clone())]),
            },
            &BTreeMap::from([("scout".into(), bytes)]),
        )
        .unwrap();
        let unpacked = read_vpk_dir_bytes(&packed).unwrap();
        let model = &unpacked.files["models/weapons/c_models/c_scout_animations.mdl"];
        let rebuilt_animation = parse_stock_animation_mdl(model).unwrap();
        let rebuilt_bone = parse_stock_bone_mdl(model).unwrap();
        let pose = parse_stock_pose_mdl(model, &rebuilt_animation, &rebuilt_bone).unwrap();
        assert_eq!(unpacked.files.len(), 1);
        assert_eq!(rebuilt_animation.animations, animation.animations);
        assert_eq!(rebuilt_bone.bones, bone.bones);
        assert_eq!(pose.animations[0].root.raw, 1);
        assert_eq!(pose.animations[0].weapon.raw, 1);
        assert_eq!(pose.animations[1].root.raw, 1);
        assert_eq!(pose.animations[1].weapon.raw, 1);
        assert_eq!(pose.animations[1].weapon.compressed, 0);
    }

    #[test]
    fn stale_catalog_patch_or_model_bytes_refuse_the_pack() {
        let bytes = fixture();
        let animation = parse_stock_animation_mdl(&bytes).unwrap();
        let bone = parse_stock_bone_mdl(&bytes).unwrap();
        let catalog = fixture_catalog();
        let request = fixture_request(&catalog);
        let mut animations = StockAnimationIndex {
            patch_version: "next".into(),
            models: BTreeMap::from([("scout".into(), animation)]),
        };
        let bones = StockBoneIndex {
            patch_version: "fixture".into(),
            models: BTreeMap::from([("scout".into(), bone)]),
        };
        let model_bytes = BTreeMap::from([("scout".into(), bytes.clone())]);
        assert!(prototype_selected_group_vpk(
            &catalog,
            &request,
            &animations,
            &bones,
            &model_bytes
        )
        .unwrap_err()
        .0
        .contains("different TF2 patches"));
        animations.patch_version = "fixture".into();
        let mut changed = bytes;
        let last = changed.len() - 1;
        changed[last] ^= 1;
        assert!(prototype_selected_group_vpk(
            &catalog,
            &request,
            &animations,
            &bones,
            &BTreeMap::from([("scout".into(), changed)])
        )
        .unwrap_err()
        .0
        .contains("verified installed indexes"));
        let mut stale = catalog;
        stale.groups[0].item_ids = vec![42];
        assert!(
            prototype_selected_group_vpk(&stale, &request, &animations, &bones, &model_bytes)
                .unwrap_err()
                .0
                .contains("catalog changed")
        );
    }
}
