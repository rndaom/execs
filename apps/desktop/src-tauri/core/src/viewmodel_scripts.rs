//! Bounded, read-only weapon-script roles for Viewmodels source mapping.
//!
//! Valve's TF2 weapon parser initializes the role to primary and reads
//! `WeaponType` from the script's KeyValues root. An item `anim_slot` can
//! override this role.
//! This module records that narrow relationship without guessing which script
//! a renamed weapon class or specialized runtime path uses.

use std::collections::BTreeMap;
use std::path::Path;

use crate::crosshair::decode_weapon_bytes;
use crate::finder::normalize_tf2_root;
use crate::hash::{read_small_file_bounded, sha256_hex};
use crate::steam_inf::parse_steam_inf;
use crate::vdf::{parse_hud_vdf, VdfValue};
use crate::viewmodel_items::StockItem;
use crate::viewmodel_source::StockSourceError;
use crate::vpk::{crc32, map_vpk_entries, read_vpk_entry, VpkEntryLocation};

const MAX_STEAM_INF_BYTES: usize = 64 * 1024;
const MAX_SCRIPTS: usize = 512;
const MAX_SCRIPT_BYTES: usize = 256 * 1024;
const MAX_TOTAL_SCRIPT_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StockWeaponScript {
    pub path: String,
    pub sha256: String,
    /// `None` means the constructor's documented primary default applies.
    /// Unknown explicit values remain available for unresolved reporting.
    pub weapon_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StockWeaponScriptIndex {
    pub patch_version: String,
    /// Lowercase `tf_weapon_*` stem to parsed source metadata.
    pub scripts: BTreeMap<String, StockWeaponScript>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ItemRoleSource {
    ItemOverride,
    UnsupportedItemOverride,
    WeaponScript,
    WeaponScriptDefault,
    /// The installed item uses the generic shotgun class; a class-specific
    /// script is a candidate, pending confirmation of the retail equip path.
    ShotgunClassCandidate,
    Unresolved,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemRole {
    pub role: Option<String>,
    pub source: ItemRoleSource,
    pub script_path: Option<String>,
}

fn invalid(message: impl Into<String>) -> StockSourceError {
    StockSourceError(message.into())
}

fn script_stem(path: &str) -> Option<String> {
    let lower = path.to_ascii_lowercase();
    let name = lower.strip_prefix("scripts/")?;
    let stem = name
        .strip_suffix(".ctx")
        .or_else(|| name.strip_suffix(".txt"))?;
    if !stem.starts_with("tf_weapon_")
        || stem.len() > 128
        || !stem
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return None;
    }
    Some(stem.into())
}

fn known_weapon_type(value: &str) -> bool {
    matches!(
        value,
        "PRIMARY" | "SECONDARY" | "MELEE" | "GRENADE" | "BUILDING" | "PDA" | "ITEM1" | "ITEM2"
    )
}

fn known_item_override(value: &str) -> bool {
    known_weapon_type(value)
        || matches!(
            value,
            "HEAD"
                | "MISC"
                | "ITEM3"
                | "ITEM4"
                | "MELEE_ALLCLASS"
                | "SECONDARY2"
                | "PRIMARY2"
                | "PASSTIME_BALL"
        )
}

/// Parse one already bounded stock script. Unknown explicit types remain
/// visible, because this pinned SDK parser may lag the installed game.
pub fn parse_weapon_type(bytes: &[u8]) -> Result<Option<String>, StockSourceError> {
    if bytes.len() > MAX_SCRIPT_BYTES {
        return Err(invalid("weapon script exceeds 256 KiB"));
    }
    let decoded = decode_weapon_bytes(bytes)
        .map_err(|error| invalid(format!("could not decode weapon script: {error}")))?;
    let tree = parse_hud_vdf(&decoded)
        .map_err(|error| invalid(format!("could not parse weapon script: {error}")))?;
    let [(_, VdfValue::Obj(data))] = tree.entries.as_slice() else {
        return Err(invalid("weapon script has no single root object"));
    };
    match data.get("WeaponType") {
        None => Ok(None),
        Some(VdfValue::Str(value)) => {
            let value = value.to_ascii_uppercase();
            if !value.is_empty()
                && value.len() <= 64
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
            {
                Ok(Some(value))
            } else {
                Err(invalid("WeaponType is not a bounded identifier"))
            }
        }
        Some(VdfValue::Obj(_)) => Err(invalid("WeaponType is not a string")),
    }
}

fn selected_entries(vpk: &Path) -> Result<BTreeMap<String, VpkEntryLocation>, StockSourceError> {
    let entries = map_vpk_entries(vpk)
        .map_err(|error| invalid(format!("could not map weapon script VPK: {}", error.0)))?;
    let mut selected = BTreeMap::new();
    let mut total = 0usize;
    for (path, entry) in entries {
        if script_stem(&path).is_none() {
            continue;
        }
        if entry.total_len() > MAX_SCRIPT_BYTES {
            return Err(invalid(format!("weapon script {path} exceeds 256 KiB")));
        }
        total = total
            .checked_add(entry.total_len())
            .ok_or_else(|| invalid("weapon scripts exceed the total byte limit"))?;
        if selected.len() >= MAX_SCRIPTS || total > MAX_TOTAL_SCRIPT_BYTES {
            return Err(invalid(
                "weapon scripts exceed the count or total byte limit",
            ));
        }
        selected.insert(path, entry);
    }
    if selected.is_empty() {
        return Err(invalid("no installed tf_weapon scripts were found"));
    }
    Ok(selected)
}

fn checked_script_bytes(
    vpk: &Path,
    path: &str,
    entry: &VpkEntryLocation,
) -> Result<Vec<u8>, StockSourceError> {
    let bytes = read_vpk_entry(vpk, entry)
        .map_err(|error| invalid(format!("could not read {path}: {}", error.0)))?;
    if crc32(&bytes) != entry.crc {
        return Err(invalid(format!("{path} differs from its VPK CRC")));
    }
    Ok(bytes)
}

/// Read stock scripts from the confirmed app-440 archive and recheck every
/// selected entry and the patch after decoding. No game file is written.
pub fn read_stock_weapon_scripts(
    tf2_root: &Path,
) -> Result<StockWeaponScriptIndex, StockSourceError> {
    let root = normalize_tf2_root(tf2_root).map_err(|error| invalid(error.message()))?;
    let inf_path = root.join("tf/steam.inf");
    let inf = read_small_file_bounded(&inf_path, MAX_STEAM_INF_BYTES)
        .map_err(|error| invalid(format!("could not read tf/steam.inf: {error}")))?;
    let inf_text = std::str::from_utf8(&inf).map_err(|_| invalid("tf/steam.inf is not UTF-8"))?;
    let patch_version = parse_steam_inf(inf_text)
        .remove("patchversion")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid("TF2 patch version is missing"))?;
    let vpk = root.join("tf/tf2_misc_dir.vpk");
    let entries = selected_entries(&vpk)?;
    let mut scripts = BTreeMap::new();
    for (path, entry) in &entries {
        let stem = script_stem(path).expect("selected script path");
        let bytes = checked_script_bytes(&vpk, path, entry)?;
        let script = StockWeaponScript {
            path: path.clone(),
            sha256: sha256_hex(&bytes),
            weapon_type: parse_weapon_type(&bytes)
                .map_err(|error| invalid(format!("{path}: {error}")))?,
        };
        if scripts.insert(stem.clone(), script).is_some() {
            return Err(invalid(format!("multiple stock scripts for {stem}")));
        }
    }
    let updated_inf = read_small_file_bounded(&inf_path, MAX_STEAM_INF_BYTES)
        .map_err(|error| invalid(format!("could not recheck tf/steam.inf: {error}")))?;
    if updated_inf != inf {
        return Err(invalid("TF2 patch changed during weapon script inspection"));
    }
    let updated_entries = selected_entries(&vpk)?;
    if updated_entries != entries {
        return Err(invalid(
            "TF2 weapon script locations changed during inspection",
        ));
    }
    for (path, entry) in &updated_entries {
        let bytes = checked_script_bytes(&vpk, path, entry)?;
        let stem = script_stem(path).expect("selected script path");
        if sha256_hex(&bytes) != scripts.get(&stem).expect("script indexed above").sha256 {
            return Err(invalid(format!(
                "TF2 weapon script {path} changed during inspection"
            )));
        }
    }
    Ok(StockWeaponScriptIndex {
        patch_version,
        scripts,
    })
}

/// Resolve only an exact installed `item_class` script stem. Schema overrides
/// take precedence; unknown/missing script identities remain unresolved.
pub fn resolve_item_role(item: &StockItem, scripts: &StockWeaponScriptIndex) -> ItemRole {
    if let Some(role) = item
        .animation_slot
        .as_deref()
        .filter(|role| !role.is_empty() && *role != "FORCE_NOT_USED")
    {
        return ItemRole {
            role: known_item_override(role).then(|| role.to_string()),
            source: if known_item_override(role) {
                ItemRoleSource::ItemOverride
            } else {
                ItemRoleSource::UnsupportedItemOverride
            },
            script_path: None,
        };
    }
    let stem = item.item_class.to_ascii_lowercase();
    let Some(script) = scripts.scripts.get(&stem) else {
        return ItemRole {
            role: None,
            source: ItemRoleSource::Unresolved,
            script_path: None,
        };
    };
    match &script.weapon_type {
        Some(value) if known_weapon_type(value) => ItemRole {
            role: Some(value.clone()),
            source: ItemRoleSource::WeaponScript,
            script_path: Some(script.path.clone()),
        },
        Some(_) => ItemRole {
            role: None,
            source: ItemRoleSource::Unresolved,
            script_path: Some(script.path.clone()),
        },
        None => ItemRole {
            role: Some("PRIMARY".into()),
            source: ItemRoleSource::WeaponScriptDefault,
            script_path: Some(script.path.clone()),
        },
    }
}

/// Keep generic shotgun items class-specific. The installed schema has
/// single-class shotguns and multi-class descendants, while Valve's weapon
/// registration gives the four classes distinct script names. This narrows
/// the candidate for each class; it does not prove the runtime equip alias.
pub fn resolve_item_role_for_class(
    item: &StockItem,
    class: &str,
    scripts: &StockWeaponScriptIndex,
) -> ItemRole {
    if !item.classes.iter().any(|eligible| eligible == class) {
        return ItemRole {
            role: None,
            source: ItemRoleSource::Unresolved,
            script_path: None,
        };
    }
    let exact = resolve_item_role(item, scripts);
    if !item.item_class.eq_ignore_ascii_case("tf_weapon_shotgun")
        || exact.source != ItemRoleSource::Unresolved
        || exact.script_path.is_some()
    {
        return exact;
    }
    let stem = match class {
        "engineer" => "tf_weapon_shotgun_primary",
        "soldier" => "tf_weapon_shotgun_soldier",
        "heavy" => "tf_weapon_shotgun_hwg",
        "pyro" => "tf_weapon_shotgun_pyro",
        _ => return exact,
    };
    let Some(script) = scripts.scripts.get(stem) else {
        return exact;
    };
    let role = match script.weapon_type.as_deref() {
        Some(value) if known_weapon_type(value) => Some(value.to_string()),
        None => Some("PRIMARY".to_string()),
        Some(_) => None,
    };
    ItemRole {
        source: if role.is_some() {
            ItemRoleSource::ShotgunClassCandidate
        } else {
            ItemRoleSource::Unresolved
        },
        role,
        script_path: Some(script.path.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const PRIMARY: &str = "\"WeaponData\" { \"WeaponType\" \"primary\" }";
    const DEFAULT: &str = "\"WeaponData\" { \"Damage\" \"5\" }";

    fn item() -> StockItem {
        StockItem {
            id: 1,
            name: "fixture".into(),
            item_class: "tf_weapon_example".into(),
            attach_to_hands: true,
            attach_to_hands_vm_only: false,
            loadout_slot: Some("secondary".into()),
            class_loadout_slots: BTreeMap::from([("scout".into(), Some("secondary".into()))]),
            animation_slot: None,
            classes: vec!["scout".into()],
            common_replacements: BTreeMap::new(),
            red_replacements: BTreeMap::new(),
            blu_replacements: BTreeMap::new(),
            has_team_visuals: false,
        }
    }

    #[test]
    fn parses_plain_and_encrypted_weapon_types_and_preserves_unknown() {
        assert_eq!(
            parse_weapon_type(PRIMARY.as_bytes()).unwrap().as_deref(),
            Some("PRIMARY")
        );
        let encrypted =
            crate::ice::encrypt_weapon_ctx(b"\"WeaponData\" { \"WeaponType\" \"secondary\" }");
        assert_eq!(
            parse_weapon_type(&encrypted).unwrap().as_deref(),
            Some("SECONDARY")
        );
        assert_eq!(parse_weapon_type(DEFAULT.as_bytes()).unwrap(), None);
        assert_eq!(
            parse_weapon_type(b"fWeaponData { WeaponType secondary }").unwrap(),
            Some("SECONDARY".into())
        );
        assert_eq!(
            parse_weapon_type(b"\"WeaponData\" { \"WeaponType\" \"future\" }").unwrap(),
            Some("FUTURE".into())
        );
    }

    #[test]
    fn schema_override_precedes_script_and_unmatched_class_stays_unresolved() {
        let mut scripts = StockWeaponScriptIndex {
            patch_version: "fixture".into(),
            scripts: BTreeMap::from([(
                "tf_weapon_example".into(),
                StockWeaponScript {
                    path: "scripts/tf_weapon_example.ctx".into(),
                    sha256: "fixture".into(),
                    weapon_type: Some("PRIMARY".into()),
                },
            )]),
        };
        let mut item = item();
        let script_role = resolve_item_role(&item, &scripts);
        assert_eq!(script_role.role.as_deref(), Some("PRIMARY"));
        assert_eq!(script_role.source, ItemRoleSource::WeaponScript);
        item.animation_slot = Some("ITEM1".into());
        let override_role = resolve_item_role(&item, &scripts);
        assert_eq!(override_role.role.as_deref(), Some("ITEM1"));
        assert_eq!(override_role.source, ItemRoleSource::ItemOverride);
        item.animation_slot = None;
        scripts
            .scripts
            .get_mut("tf_weapon_example")
            .unwrap()
            .weapon_type = None;
        assert_eq!(
            resolve_item_role(&item, &scripts).source,
            ItemRoleSource::WeaponScriptDefault
        );
        item.item_class = "tf_weapon_missing".into();
        assert_eq!(
            resolve_item_role(&item, &scripts).source,
            ItemRoleSource::Unresolved
        );
        item.item_class = "tf_weapon_example".into();
        scripts
            .scripts
            .get_mut("tf_weapon_example")
            .unwrap()
            .weapon_type = Some("UTILITY".into());
        assert_eq!(
            resolve_item_role(&item, &scripts).source,
            ItemRoleSource::Unresolved
        );
        scripts
            .scripts
            .get_mut("tf_weapon_example")
            .unwrap()
            .weapon_type = Some("SECONDARY".into());
        item.animation_slot = Some("FORCE_NOT_USED".into());
        let forced_script = resolve_item_role(&item, &scripts);
        assert_eq!(forced_script.source, ItemRoleSource::WeaponScript);
        assert_eq!(forced_script.role.as_deref(), Some("SECONDARY"));
        item.animation_slot = Some("PASSTIME_BALL".into());
        assert_eq!(
            resolve_item_role(&item, &scripts).source,
            ItemRoleSource::ItemOverride
        );
        item.animation_slot = Some("FUTURE".into());
        assert_eq!(
            resolve_item_role(&item, &scripts).source,
            ItemRoleSource::UnsupportedItemOverride
        );
        item.animation_slot = Some(String::new());
        scripts
            .scripts
            .get_mut("tf_weapon_example")
            .unwrap()
            .weapon_type = Some("PRIMARY".into());
        assert_eq!(
            resolve_item_role(&item, &scripts).source,
            ItemRoleSource::WeaponScript
        );
    }

    #[test]
    fn installed_reader_rejects_modified_script_crc() {
        let dir = crate::test_temp_dir();
        let tf = dir.join("Team Fortress 2/tf");
        fs::create_dir_all(&tf).unwrap();
        fs::write(tf.join("steam.inf"), b"appID=440\nPatchVersion=fixture\n").unwrap();
        let path = "scripts/tf_weapon_example.txt";
        let vpk = tf.join("tf2_misc_dir.vpk");
        fs::write(
            &vpk,
            crate::vpk::write_vpk_v2(&BTreeMap::from([(
                path.into(),
                PRIMARY.as_bytes().to_vec(),
            )])),
        )
        .unwrap();
        let root = dir.join("Team Fortress 2");
        assert_eq!(read_stock_weapon_scripts(&root).unwrap().scripts.len(), 1);
        let entry = map_vpk_entries(&vpk).unwrap()[path].clone();
        let mut bytes = fs::read(&vpk).unwrap();
        let at = (entry.data_base + u64::from(entry.offset)) as usize;
        bytes[at + 5] ^= 1;
        fs::write(&vpk, bytes).unwrap();
        assert!(read_stock_weapon_scripts(&root)
            .unwrap_err()
            .0
            .contains("VPK CRC"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn generic_shotgun_candidates_follow_class_and_preserve_override_priority() {
        let scripts = StockWeaponScriptIndex {
            patch_version: "fixture".into(),
            scripts: BTreeMap::from([
                (
                    "tf_weapon_shotgun_primary".into(),
                    StockWeaponScript {
                        path: "scripts/tf_weapon_shotgun_primary.ctx".into(),
                        sha256: "primary".into(),
                        weapon_type: Some("PRIMARY".into()),
                    },
                ),
                (
                    "tf_weapon_shotgun_soldier".into(),
                    StockWeaponScript {
                        path: "scripts/tf_weapon_shotgun_soldier.ctx".into(),
                        sha256: "soldier".into(),
                        weapon_type: Some("SECONDARY".into()),
                    },
                ),
            ]),
        };
        let mut shotgun = item();
        shotgun.item_class = "tf_weapon_shotgun".into();
        shotgun.classes = vec!["engineer".into(), "soldier".into()];
        let engineer = resolve_item_role_for_class(&shotgun, "engineer", &scripts);
        assert_eq!(engineer.role.as_deref(), Some("PRIMARY"));
        assert_eq!(engineer.source, ItemRoleSource::ShotgunClassCandidate);
        let soldier = resolve_item_role_for_class(&shotgun, "soldier", &scripts);
        assert_eq!(soldier.role.as_deref(), Some("SECONDARY"));
        assert_eq!(soldier.source, ItemRoleSource::ShotgunClassCandidate);
        assert_eq!(
            resolve_item_role_for_class(&shotgun, "pyro", &scripts).source,
            ItemRoleSource::Unresolved
        );
        shotgun.animation_slot = Some("ITEM1".into());
        assert_eq!(
            resolve_item_role_for_class(&shotgun, "soldier", &scripts).source,
            ItemRoleSource::ItemOverride
        );
        assert_eq!(
            resolve_item_role_for_class(&shotgun, "scout", &scripts).source,
            ItemRoleSource::Unresolved
        );
    }
}
