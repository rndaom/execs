//! Read-only item metadata for deriving Viewmodels choices from installed TF2.
//!
//! This is source evidence, not a claim that an item reaches a particular
//! sequence in retail TF2. Weapon scripts, activity translation and special
//! weapon behavior must be resolved before the builder can use this catalog.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use crate::finder::normalize_tf2_root;
use crate::hash::{read_small_file_bounded, sha256_hex, validate_file_within};
use crate::steam_inf::parse_steam_inf;
use crate::vdf::{parse_hud_vdf, VdfMap, VdfValue};
use crate::viewmodel_source::{StockAnimationIndex, StockAnimationModel, StockSourceError};
use crate::vpk::{crc32, map_vpk_entries, read_vpk_entry, VpkEntryLocation};

const SCHEMA_PATH: &str = "scripts/items/items_game.txt";
const MAX_SCHEMA_BYTES: usize = 16 * 1024 * 1024;
const MAX_STEAM_INF_BYTES: usize = 64 * 1024;
const MAX_PREFAB_DEPTH: usize = 16;
const MAX_ITEM_DEFINITIONS: usize = 20_000;
const CLASSES: [&str; 9] = [
    "scout", "soldier", "pyro", "demoman", "heavy", "engineer", "medic", "sniper", "spy",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StockItem {
    pub id: u32,
    /// Installed schema identifier, not a localized display label.
    pub name: String,
    pub item_class: String,
    /// TF2 chooses the shared class hands viewmodel only when this is set.
    pub attach_to_hands: bool,
    /// Separate installed flag for viewmodel-only attachment behavior.
    pub attach_to_hands_vm_only: bool,
    /// Default `item_slot`; TF2 can override it inside `used_by_classes`.
    pub loadout_slot: Option<String>,
    /// Effective loadout slot for each eligible class. `None` means the item
    /// has no known slot, not that its animation role matches another slot.
    pub class_loadout_slots: BTreeMap<String, Option<String>>,
    /// None means the weapon-script role remains unresolved.
    pub animation_slot: Option<String>,
    pub classes: Vec<String>,
    /// The neutral `visuals` block before team selection.
    pub common_replacements: BTreeMap<String, String>,
    /// Effective RED and BLU replacements after `use_visualsblock_as_base`.
    /// An absent team block falls back to `visuals`; a present block is separate
    /// unless it explicitly inherits an earlier block.
    pub red_replacements: BTreeMap<String, String>,
    pub blu_replacements: BTreeMap<String, String>,
    /// Team-specific visuals may affect the model even without activity edits.
    pub has_team_visuals: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StockItemCatalog {
    pub patch_version: String,
    pub schema_sha256: String,
    pub items: BTreeMap<u32, StockItem>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CandidateSequence {
    pub label: String,
    /// Every blend cell in the stock sequence, including repeated references.
    pub animations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplacementCandidate {
    pub item_id: u32,
    pub class: String,
    /// Effective `red` or `blu` visual selected by the engine.
    pub visual: &'static str,
    pub base_activity: String,
    pub target_activity: String,
    /// Empty means this class MDL has no direct local sequence for the target.
    pub sequences: Vec<CandidateSequence>,
}

fn replacement_candidates_for(
    out: &mut Vec<ReplacementCandidate>,
    item_id: u32,
    class: &str,
    visual: &'static str,
    replacements: &BTreeMap<String, String>,
    model: &StockAnimationModel,
) -> Result<(), StockSourceError> {
    for (base_activity, target_activity) in replacements {
        let sequences = model
            .sequences
            .iter()
            .filter(|sequence| {
                sequence
                    .activity
                    .as_deref()
                    .is_some_and(|activity| activity.eq_ignore_ascii_case(target_activity))
            })
            .map(|sequence| {
                let animations = sequence
                    .animation_indexes
                    .iter()
                    .map(|index| {
                        model
                            .animations
                            .get(*index)
                            .map(|animation| animation.name.clone())
                            .ok_or_else(|| {
                                invalid("stock sequence references an invalid animation")
                            })
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(CandidateSequence {
                    label: sequence.label.clone(),
                    animations,
                })
            })
            .collect::<Result<Vec<_>, StockSourceError>>()?;
        out.push(ReplacementCandidate {
            item_id,
            class: class.to_string(),
            visual,
            base_activity: base_activity.clone(),
            target_activity: target_activity.clone(),
            sequences,
        });
    }
    Ok(())
}

/// Find direct MDL candidates for explicit item-schema replacements. This
/// intentionally does not infer engine activity translation, inspect behavior
/// or item reachability. Unmatched targets remain in the output.
pub fn explicit_replacement_candidates(
    items: &StockItemCatalog,
    models: &StockAnimationIndex,
) -> Result<Vec<ReplacementCandidate>, StockSourceError> {
    if items.patch_version != models.patch_version {
        return Err(invalid(
            "item schema and MDLs come from different TF2 patches",
        ));
    }
    let mut out = Vec::new();
    for item in items.items.values() {
        for class in &item.classes {
            let model_id = if class == "demoman" { "demo" } else { class };
            let model = models
                .models
                .get(model_id)
                .ok_or_else(|| invalid(format!("class {class} animation model is missing")))?;
            for (visual, replacements) in [
                ("red", &item.red_replacements),
                ("blu", &item.blu_replacements),
            ] {
                replacement_candidates_for(&mut out, item.id, class, visual, replacements, model)?;
            }
        }
    }
    Ok(out)
}

fn invalid(message: impl Into<String>) -> StockSourceError {
    StockSourceError(message.into())
}

fn object<'a>(map: &'a VdfMap, key: &str) -> Result<&'a VdfMap, StockSourceError> {
    map.get(key)
        .and_then(VdfValue::as_obj)
        .ok_or_else(|| invalid(format!("item schema is missing object {key}")))
}

fn optional_object<'a>(map: &'a VdfMap, key: &str) -> Result<Option<&'a VdfMap>, StockSourceError> {
    match map.get(key) {
        None => Ok(None),
        Some(VdfValue::Obj(value)) => Ok(Some(value)),
        Some(VdfValue::Str(_)) => Err(invalid(format!("item schema {key} is not an object"))),
    }
}

fn optional_string<'a>(map: &'a VdfMap, key: &str) -> Result<Option<&'a str>, StockSourceError> {
    match map.get(key) {
        None => Ok(None),
        Some(VdfValue::Str(value)) => Ok(Some(value)),
        Some(VdfValue::Obj(_)) => Err(invalid(format!("item schema {key} is not a string"))),
    }
}

fn schema_bool(map: &VdfMap, key: &str) -> Result<bool, StockSourceError> {
    match optional_string(map, key)? {
        None | Some("0") => Ok(false),
        Some("1") => Ok(true),
        Some(_) => Err(invalid(format!("item schema {key} is not 0 or 1"))),
    }
}

fn normalize_loadout_slot(value: &str) -> String {
    if value.eq_ignore_ascii_case("head") {
        "misc".into()
    } else {
        value.to_ascii_lowercase()
    }
}

fn known_class_slot(value: &str) -> bool {
    matches!(
        value,
        "primary"
            | "secondary"
            | "melee"
            | "utility"
            | "building"
            | "pda"
            | "pda2"
            | "head"
            | "misc"
            | "action"
            | "taunt"
    )
}

fn inherited(
    node: &VdfMap,
    prefabs: &VdfMap,
    ancestors: &mut BTreeSet<String>,
    depth: usize,
) -> Result<VdfMap, StockSourceError> {
    if depth > MAX_PREFAB_DEPTH {
        return Err(invalid("item prefab depth exceeds 16"));
    }
    let mut result = VdfMap::default();
    for name in optional_string(node, "prefab")?
        .unwrap_or("")
        .split_whitespace()
    {
        let name = name.to_ascii_lowercase();
        if !ancestors.insert(name.clone()) {
            return Err(invalid(format!("item prefab cycle at {name}")));
        }
        let parent = object(prefabs, &name)
            .map_err(|_| invalid(format!("item prefab {name} is missing")))?;
        result.merge_from(&inherited(parent, prefabs, ancestors, depth + 1)?);
        ancestors.remove(&name);
    }
    result.merge_from(node);
    Ok(result)
}

fn replacements(
    visual: Option<&VdfMap>,
    earlier: &[(&str, &BTreeMap<String, String>)],
    context: &str,
) -> Result<Option<BTreeMap<String, String>>, StockSourceError> {
    let mut result = BTreeMap::new();
    let Some(visual) = visual else {
        return Ok(None);
    };
    for (key, value) in &visual.entries {
        if key.eq_ignore_ascii_case("use_visualsblock_as_base") {
            let name = value
                .as_str()
                .ok_or_else(|| invalid(format!("{context} visual base is not a string")))?;
            let base = earlier
                .iter()
                .find(|(earlier_name, _)| name.eq_ignore_ascii_case(earlier_name))
                .ok_or_else(|| invalid(format!("{context} refers to unavailable visual {name}")))?;
            result.clone_from(base.1);
        } else if key.eq_ignore_ascii_case("animation_replacement") {
            let table = value
                .as_obj()
                .ok_or_else(|| invalid(format!("{context} replacements are not an object")))?;
            let mut seen = BTreeSet::new();
            for (from, value) in &table.entries {
                let to = value.as_str().ok_or_else(|| {
                    invalid(format!("{context} replacement {from} is not a string"))
                })?;
                let from = from.to_ascii_uppercase();
                let to = to.to_ascii_uppercase();
                if from.is_empty()
                    || to.is_empty()
                    || from.len() > 128
                    || to.len() > 128
                    || !from.bytes().all(|byte| {
                        byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_'
                    })
                    || !to.bytes().all(|byte| {
                        byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_'
                    })
                    || !seen.insert(from.clone())
                {
                    return Err(invalid(format!(
                        "{context} has an invalid or duplicate activity replacement {from}"
                    )));
                }
                result.insert(from, to);
            }
        }
    }
    Ok(Some(result))
}

/// Resolve numeric item definitions and prefab-provided Viewmodels metadata.
/// This retains items without `anim_slot`; their script-derived role is pending.
pub fn parse_stock_item_schema(
    bytes: &[u8],
    patch_version: String,
) -> Result<StockItemCatalog, StockSourceError> {
    if bytes.len() > MAX_SCHEMA_BYTES {
        return Err(invalid("TF2 item schema exceeds 16 MiB"));
    }
    let text = std::str::from_utf8(bytes)
        .map_err(|_| invalid("TF2 item schema is not UTF-8"))?
        .trim_start_matches('\u{feff}');
    let schema = parse_hud_vdf(text).map_err(|error| invalid(format!("item schema: {error}")))?;
    let game = object(&schema, "items_game")?;
    let items = object(game, "items")?;
    let prefabs = object(game, "prefabs")?;
    let mut result = BTreeMap::new();
    for (id, value) in &items.entries {
        let Ok(id) = id.parse::<u32>() else { continue };
        if result.len() >= MAX_ITEM_DEFINITIONS {
            return Err(invalid("item schema exceeds the item definition limit"));
        }
        let raw = value
            .as_obj()
            .ok_or_else(|| invalid(format!("item {id} is not an object")))?;
        let item = inherited(raw, prefabs, &mut BTreeSet::new(), 0)
            .map_err(|error| invalid(format!("item {id}: {error}")))?;
        let class_map = optional_object(&item, "used_by_classes")?;
        let loadout_slot = optional_string(&item, "item_slot")?.map(normalize_loadout_slot);
        let mut classes = Vec::new();
        let mut class_loadout_slots = BTreeMap::new();
        if let Some(class_map) = class_map {
            for class in CLASSES {
                if let Some(value) = optional_string(class_map, class)? {
                    // Valve marks a class usable when its key exists. `1` uses
                    // the default; a recognized name selects a class slot.
                    // An unknown name leaves the default slot in place.
                    let override_slot = value.to_ascii_lowercase();
                    let slot = if value.starts_with('1') || !known_class_slot(&override_slot) {
                        loadout_slot.clone()
                    } else {
                        Some(override_slot)
                    };
                    classes.push(class.to_string());
                    class_loadout_slots.insert(class.to_string(), slot);
                }
            }
        }
        if classes.is_empty() {
            continue;
        }
        let common = optional_object(&item, "visuals")?;
        let red = optional_object(&item, "visuals_red")?;
        let blu = optional_object(&item, "visuals_blu")?;
        let common_replacements =
            replacements(common, &[], &format!("item {id} visuals"))?.unwrap_or_default();
        let mut red_bases = Vec::new();
        if common.is_some() {
            red_bases.push(("visuals", &common_replacements));
        }
        let red_replacements = replacements(red, &red_bases, &format!("item {id} RED visuals"))?
            .unwrap_or_else(|| common_replacements.clone());
        let mut blu_bases = red_bases;
        if red.is_some() {
            blu_bases.push(("visuals_red", &red_replacements));
        }
        let blu_replacements = replacements(blu, &blu_bases, &format!("item {id} BLU visuals"))?
            .unwrap_or_else(|| common_replacements.clone());
        let record = StockItem {
            id,
            name: optional_string(&item, "name")?.unwrap_or("").to_string(),
            item_class: optional_string(&item, "item_class")?
                .unwrap_or("")
                .to_string(),
            attach_to_hands: schema_bool(&item, "attach_to_hands")?,
            attach_to_hands_vm_only: schema_bool(&item, "attach_to_hands_vm_only")?,
            loadout_slot,
            class_loadout_slots,
            animation_slot: optional_string(&item, "anim_slot")?.map(str::to_ascii_uppercase),
            classes,
            common_replacements,
            red_replacements,
            blu_replacements,
            has_team_visuals: red.is_some() || blu.is_some(),
        };
        if result.insert(id, record).is_some() {
            return Err(invalid(format!("duplicate item definition {id}")));
        }
    }
    if result.is_empty() {
        return Err(invalid("TF2 item schema has no class-eligible definitions"));
    }
    Ok(StockItemCatalog {
        patch_version,
        schema_sha256: sha256_hex(bytes),
        items: result,
    })
}

enum SchemaLocation {
    Loose,
    Vpk(VpkEntryLocation),
}

fn read_schema(root: &Path) -> Result<(Vec<u8>, SchemaLocation), StockSourceError> {
    let loose = root.join("tf").join(SCHEMA_PATH);
    if loose.exists() {
        validate_file_within(root, &loose)
            .map_err(|error| invalid(format!("unsafe loose item schema: {error}")))?;
        let bytes = read_small_file_bounded(&loose, MAX_SCHEMA_BYTES)
            .map_err(|error| invalid(format!("could not read loose item schema: {error}")))?;
        return Ok((bytes, SchemaLocation::Loose));
    }
    let vpk = root.join("tf/tf2_misc_dir.vpk");
    let entries = map_vpk_entries(&vpk)
        .map_err(|error| invalid(format!("could not map item schema VPK: {}", error.0)))?;
    let entry = entries
        .get(SCHEMA_PATH)
        .ok_or_else(|| invalid("installed item schema is missing"))?;
    if entry.total_len() > MAX_SCHEMA_BYTES {
        return Err(invalid("TF2 item schema exceeds 16 MiB"));
    }
    let bytes = read_vpk_entry(&vpk, entry)
        .map_err(|error| invalid(format!("could not read item schema VPK entry: {}", error.0)))?;
    if crc32(&bytes) != entry.crc {
        return Err(invalid("item schema differs from its VPK CRC"));
    }
    Ok((bytes, SchemaLocation::Vpk(entry.clone())))
}

/// Read the confirmed app-440 install and recheck the same schema source after
/// parsing, so a TF2 update cannot silently mix two source revisions.
pub fn read_stock_item_catalog(tf2_root: &Path) -> Result<StockItemCatalog, StockSourceError> {
    let root = normalize_tf2_root(tf2_root).map_err(|error| invalid(error.message()))?;
    let inf_path = root.join("tf/steam.inf");
    let inf = read_small_file_bounded(&inf_path, MAX_STEAM_INF_BYTES)
        .map_err(|error| invalid(format!("could not read tf/steam.inf: {error}")))?;
    let inf_text = std::str::from_utf8(&inf).map_err(|_| invalid("tf/steam.inf is not UTF-8"))?;
    let patch_version = parse_steam_inf(inf_text)
        .remove("patchversion")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid("TF2 patch version is missing"))?;
    let (schema, location) = read_schema(&root)?;
    let catalog = parse_stock_item_schema(&schema, patch_version)?;
    let updated_inf = read_small_file_bounded(&inf_path, MAX_STEAM_INF_BYTES)
        .map_err(|error| invalid(format!("could not recheck tf/steam.inf: {error}")))?;
    if updated_inf != inf {
        return Err(invalid("TF2 patch changed during item schema inspection"));
    }
    let (updated_schema, updated_location) = read_schema(&root)?;
    let same_location = match (location, updated_location) {
        (SchemaLocation::Loose, SchemaLocation::Loose) => true,
        (SchemaLocation::Vpk(a), SchemaLocation::Vpk(b)) => a == b,
        _ => false,
    };
    if !same_location || updated_schema != schema {
        return Err(invalid("TF2 item schema changed during inspection"));
    }
    Ok(catalog)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::viewmodel_source::{StockAnimation, StockAnimationModel, StockSequence};
    use std::fs;

    const SCHEMA: &str = r#"
        "items_game"
        {
            "prefabs"
            {
                "scout_weapon"
                {
                    "item_class" "tf_weapon_pistol"
                    "item_slot" "secondary"
                    "attach_to_hands" "1"
                    "attach_to_hands_vm_only" "0"
                    "used_by_classes" { "scout" "1" }
                    "visuals"
                    {
                        "animation_replacement"
                        {
                            "ACT_VM_DRAW" "ACT_SECONDARY_VM_DRAW"
                        }
                    }
                }
            }
            "items"
            {
                "220"
                {
                    "prefab" "scout_weapon"
                    "name" "Shortstop fixture"
                    "item_slot" "primary"
                    "anim_slot" "secondary"
                    "visuals"
                    {
                        "animation_replacement"
                        {
                            "ACT_VM_IDLE" "ACT_SECONDARY_VM_IDLE_2"
                        }
                    }
                    "visuals_red"
                    {
                        "animation_replacement"
                        {
                            "ACT_PRIMARY_VM_INSPECT_START" "ACT_PRIMARY_ALT1_VM_INSPECT_START"
                        }
                    }
                }
                "221" { "prefab" "scout_weapon" "attach_to_hands" "0" "attach_to_hands_vm_only" "1" }
                "222"
                {
                    "prefab" "scout_weapon"
                    "visuals"
                    {
                        "animation_replacement"
                        {
                            "ACT_VM_IDLE" "ACT_SECONDARY_VM_IDLE_2"
                        }
                    }
                    "visuals_red"
                    {
                        "use_visualsblock_as_base" "visuals"
                        "animation_replacement"
                        {
                            "ACT_VM_DRAW" "ACT_PRIMARY_VM_DRAW"
                        }
                    }
                }
                "not-an-id" { "prefab" "scout_weapon" }
            }
        }
    "#;

    #[test]
    fn resolves_prefabs_and_keeps_loadout_role_and_team_paths_distinct() {
        let catalog = parse_stock_item_schema(SCHEMA.as_bytes(), "fixture".into()).unwrap();
        assert_eq!(catalog.items.len(), 3);
        let shortstop = &catalog.items[&220];
        assert_eq!(shortstop.classes, ["scout"]);
        assert!(shortstop.attach_to_hands);
        assert!(!shortstop.attach_to_hands_vm_only);
        assert_eq!(shortstop.loadout_slot.as_deref(), Some("primary"));
        assert_eq!(
            shortstop.class_loadout_slots["scout"].as_deref(),
            Some("primary")
        );
        assert_eq!(shortstop.animation_slot.as_deref(), Some("SECONDARY"));
        assert_eq!(
            shortstop.common_replacements["ACT_VM_DRAW"],
            "ACT_SECONDARY_VM_DRAW"
        );
        assert_eq!(
            shortstop.common_replacements["ACT_VM_IDLE"],
            "ACT_SECONDARY_VM_IDLE_2"
        );
        assert_eq!(
            shortstop.red_replacements["ACT_PRIMARY_VM_INSPECT_START"],
            "ACT_PRIMARY_ALT1_VM_INSPECT_START"
        );
        assert!(!shortstop.red_replacements.contains_key("ACT_VM_DRAW"));
        assert_eq!(
            shortstop.blu_replacements["ACT_VM_DRAW"],
            "ACT_SECONDARY_VM_DRAW"
        );
        assert!(shortstop.has_team_visuals);
        assert_eq!(catalog.items[&221].animation_slot, None);
        assert_eq!(
            catalog.items[&221].red_replacements,
            catalog.items[&221].common_replacements
        );
        let inherited = &catalog.items[&222];
        assert_eq!(
            inherited.red_replacements["ACT_VM_DRAW"],
            "ACT_PRIMARY_VM_DRAW"
        );
        assert_eq!(
            inherited.red_replacements["ACT_VM_IDLE"],
            "ACT_SECONDARY_VM_IDLE_2"
        );
        assert_eq!(
            inherited.blu_replacements["ACT_VM_DRAW"],
            "ACT_SECONDARY_VM_DRAW"
        );
        assert!(!catalog.items[&221].attach_to_hands);
        assert!(catalog.items[&221].attach_to_hands_vm_only);
    }

    #[test]
    fn keeps_class_usability_and_per_class_slots_separate_from_the_default() {
        let per_class = SCHEMA.replace(
            "\"scout\" \"1\"",
            "\"scout\" \"secondary\" \"soldier\" \"0\"",
        );
        let catalog = parse_stock_item_schema(per_class.as_bytes(), "fixture".into()).unwrap();
        let item = &catalog.items[&220];
        assert_eq!(item.classes, ["scout", "soldier"]);
        assert_eq!(item.loadout_slot.as_deref(), Some("primary"));
        assert_eq!(
            item.class_loadout_slots["scout"].as_deref(),
            Some("secondary")
        );
        // A class key marks usability even when its value does not name a slot.
        assert_eq!(
            item.class_loadout_slots["soldier"].as_deref(),
            Some("primary")
        );

        let head = SCHEMA.replace("\"item_slot\" \"primary\"", "\"item_slot\" \"head\"");
        let catalog = parse_stock_item_schema(head.as_bytes(), "fixture".into()).unwrap();
        assert_eq!(catalog.items[&220].loadout_slot.as_deref(), Some("misc"));
        assert_eq!(
            catalog.items[&220].class_loadout_slots["scout"].as_deref(),
            Some("misc")
        );

        let class_head = SCHEMA.replace("\"scout\" \"1\"", "\"scout\" \"head\"");
        let catalog = parse_stock_item_schema(class_head.as_bytes(), "fixture".into()).unwrap();
        assert_eq!(
            catalog.items[&220].class_loadout_slots["scout"].as_deref(),
            Some("head")
        );
    }

    #[test]
    fn refuses_prefab_cycles_and_invalid_activity_targets() {
        let cycle = SCHEMA.replace(
            "\"item_class\" \"tf_weapon_pistol\"",
            "\"prefab\" \"scout_weapon\" \"item_class\" \"tf_weapon_pistol\"",
        );
        assert!(parse_stock_item_schema(cycle.as_bytes(), "fixture".into())
            .unwrap_err()
            .0
            .contains("cycle"));
        let invalid = SCHEMA.replace("ACT_SECONDARY_VM_IDLE_2", "not-an-activity");
        assert!(
            parse_stock_item_schema(invalid.as_bytes(), "fixture".into())
                .unwrap_err()
                .0
                .contains("invalid")
        );
        let future_visual = SCHEMA.replace(
            "\"use_visualsblock_as_base\" \"visuals\"",
            "\"use_visualsblock_as_base\" \"visuals_blu\"",
        );
        assert!(
            parse_stock_item_schema(future_visual.as_bytes(), "fixture".into())
                .unwrap_err()
                .0
                .contains("unavailable visual")
        );
        let invalid_attachment = SCHEMA.replace(
            "\"attach_to_hands\" \"1\"",
            "\"attach_to_hands\" \"future\"",
        );
        assert!(
            parse_stock_item_schema(invalid_attachment.as_bytes(), "fixture".into())
                .unwrap_err()
                .0
                .contains("attach_to_hands")
        );
    }

    #[test]
    fn installed_reader_rechecks_app_identity_and_loose_schema_bytes() {
        let dir = crate::test_temp_dir();
        let tf = dir.join("Team Fortress 2/tf");
        fs::create_dir_all(tf.join("scripts/items")).unwrap();
        let inf = tf.join("steam.inf");
        fs::write(&inf, b"appID=440\nPatchVersion=fixture\n").unwrap();
        let path = tf.join(SCHEMA_PATH);
        fs::write(&path, SCHEMA).unwrap();
        let catalog = read_stock_item_catalog(&dir.join("Team Fortress 2")).unwrap();
        assert_eq!(catalog.patch_version, "fixture");
        assert_eq!(catalog.schema_sha256, sha256_hex(SCHEMA.as_bytes()));
        fs::write(&inf, b"appID=730\nPatchVersion=fixture\n").unwrap();
        assert!(read_stock_item_catalog(&dir.join("Team Fortress 2")).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn vpk_schema_requires_the_recorded_crc() {
        let dir = crate::test_temp_dir();
        let tf = dir.join("Team Fortress 2/tf");
        fs::create_dir_all(&tf).unwrap();
        fs::write(tf.join("steam.inf"), b"appID=440\nPatchVersion=fixture\n").unwrap();
        let vpk = tf.join("tf2_misc_dir.vpk");
        fs::write(
            &vpk,
            crate::vpk::write_vpk_v2(&BTreeMap::from([(
                SCHEMA_PATH.into(),
                SCHEMA.as_bytes().to_vec(),
            )])),
        )
        .unwrap();
        let root = dir.join("Team Fortress 2");
        assert_eq!(read_stock_item_catalog(&root).unwrap().items.len(), 3);
        let entry = map_vpk_entries(&vpk).unwrap()[SCHEMA_PATH].clone();
        let mut bytes = fs::read(&vpk).unwrap();
        let at = (entry.data_base + u64::from(entry.offset)) as usize;
        bytes[at + 20] ^= 1;
        fs::write(&vpk, bytes).unwrap();
        assert!(read_stock_item_catalog(&root)
            .unwrap_err()
            .0
            .contains("VPK CRC"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn explicit_candidates_keep_unmatched_targets_and_all_blend_references() {
        let catalog = parse_stock_item_schema(SCHEMA.as_bytes(), "fixture".into()).unwrap();
        let animations = ["@draw_a", "@draw_b"]
            .into_iter()
            .map(|name| StockAnimation {
                name: name.into(),
                frames: 1,
                fps: 30.0,
            })
            .collect();
        let model = StockAnimationModel {
            model_name: "weapons/c_models/c_scout_animations.mdl".into(),
            sha256: "fixture".into(),
            animations,
            sequences: vec![StockSequence {
                label: "draw".into(),
                activity: Some("ACT_SECONDARY_VM_DRAW".into()),
                animation_indexes: vec![0, 1],
            }],
        };
        let models = StockAnimationIndex {
            patch_version: "fixture".into(),
            models: BTreeMap::from([("scout".into(), model)]),
        };
        let links = explicit_replacement_candidates(&catalog, &models).unwrap();
        let draw = links
            .iter()
            .find(|link| link.item_id == 220 && link.base_activity == "ACT_VM_DRAW")
            .unwrap();
        assert_eq!(draw.sequences[0].animations, ["@draw_a", "@draw_b"]);
        let idle = links
            .iter()
            .find(|link| link.item_id == 220 && link.base_activity == "ACT_VM_IDLE")
            .unwrap();
        assert!(idle.sequences.is_empty());
        assert!(links.iter().any(|link| link.visual == "red"));
        let mut changed = models;
        changed.patch_version = "other".into();
        assert!(explicit_replacement_candidates(&catalog, &changed).is_err());
    }
}
