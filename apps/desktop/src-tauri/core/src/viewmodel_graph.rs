//! Candidate item-to-hand-animation graph from verified installed indexes.
//!
//! This composes item visuals, weapon roles, the general hand table and the
//! separate inspect path. It records missing roles and unmatched MDL targets.
//! An edge is source evidence, not proof that retail TF2 reaches the action.

use std::collections::BTreeSet;

use crate::viewmodel_activity::{base_hand_activities, translate_hand_activity};
use crate::viewmodel_inspect::inspect_candidates;
use crate::viewmodel_items::{matching_local_sequences, CandidateSequence, StockItemCatalog};
use crate::viewmodel_scripts::{
    resolve_item_role_for_class, ItemRoleSource, StockWeaponScriptIndex,
};
use crate::viewmodel_source::{StockAnimationIndex, StockSourceError};

const MAX_ITEM_BASE_ACTIVITIES: usize = 128;
const MAX_GRAPH_EDGES: usize = 100_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivityRoute {
    ItemReplacement,
    RoleTable,
    RoleIdentity,
    Inspect,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemActivityEdge {
    pub item_id: u32,
    pub class: String,
    pub visual: &'static str,
    pub base_activity: String,
    pub target_activity: String,
    pub route: ActivityRoute,
    /// A shotgun script remains a candidate until retail equip routing passes.
    pub role_source: Option<ItemRoleSource>,
    /// Empty when the class MDL has no direct sequence for this target.
    pub sequences: Vec<CandidateSequence>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnresolvedItemRole {
    pub item_id: u32,
    pub class: String,
    pub source: ItemRoleSource,
    pub script_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StockActivityGraph {
    pub patch_version: String,
    pub edges: Vec<ItemActivityEdge>,
    pub unresolved_roles: Vec<UnresolvedItemRole>,
    /// Class-specific shotgun script links still need retail equip proof.
    pub candidate_roles: Vec<UnresolvedItemRole>,
}

fn add_edge(
    edges: &mut Vec<ItemActivityEdge>,
    edge: ItemActivityEdge,
) -> Result<(), StockSourceError> {
    if edges.len() >= MAX_GRAPH_EDGES {
        return Err(StockSourceError(
            "stock activity graph exceeds the edge limit".into(),
        ));
    }
    edges.push(edge);
    Ok(())
}

/// Build a bounded, read-only graph from one TF2 patch's independently
/// verified item, script and class-MDL indexes. Each item activity replacement
/// takes precedence over role translation. Inspect is composed separately.
pub fn candidate_activity_graph(
    items: &StockItemCatalog,
    scripts: &StockWeaponScriptIndex,
    models: &StockAnimationIndex,
) -> Result<StockActivityGraph, StockSourceError> {
    if items.patch_version != scripts.patch_version || items.patch_version != models.patch_version {
        return Err(StockSourceError(
            "Viewmodels item, script and MDL indexes come from different TF2 patches".into(),
        ));
    }
    let general_bases: BTreeSet<String> = base_hand_activities().map(str::to_string).collect();
    let mut edges = Vec::new();
    let mut unresolved_roles = Vec::new();
    let mut candidate_roles = Vec::new();
    for item in items.items.values() {
        if !item.attach_to_hands
            || !item
                .item_class
                .to_ascii_lowercase()
                .starts_with("tf_weapon_")
        {
            continue;
        }
        for class in item.class_loadout_slots.keys() {
            let model_id = if class == "demoman" { "demo" } else { class };
            let model = models.models.get(model_id).ok_or_else(|| {
                StockSourceError(format!("class {class} animation model is missing"))
            })?;
            let role = resolve_item_role_for_class(item, class, scripts);
            if role.role.is_none() {
                unresolved_roles.push(UnresolvedItemRole {
                    item_id: item.id,
                    class: class.clone(),
                    source: role.source.clone(),
                    script_path: role.script_path.clone(),
                });
            } else if role.source == ItemRoleSource::ShotgunClassCandidate {
                candidate_roles.push(UnresolvedItemRole {
                    item_id: item.id,
                    class: class.clone(),
                    source: role.source.clone(),
                    script_path: role.script_path.clone(),
                });
            }
            for (visual, replacements) in [
                ("red", &item.red_replacements),
                ("blu", &item.blu_replacements),
            ] {
                let mut bases = general_bases.clone();
                bases.extend(
                    replacements
                        .keys()
                        .filter(|base| !base.contains("_INSPECT_"))
                        .cloned(),
                );
                if bases.len() > MAX_ITEM_BASE_ACTIVITIES {
                    return Err(StockSourceError(format!(
                        "item {} has too many candidate hand activities",
                        item.id
                    )));
                }
                for base_activity in bases {
                    let (target_activity, route) =
                        if let Some(target) = replacements.get(&base_activity) {
                            (target.clone(), ActivityRoute::ItemReplacement)
                        } else if let Some(role_name) = role.role.as_deref() {
                            let translated = translate_hand_activity(role_name, &base_activity);
                            let route = if translated.matched_role_rule {
                                ActivityRoute::RoleTable
                            } else {
                                ActivityRoute::RoleIdentity
                            };
                            (translated.target, route)
                        } else {
                            continue;
                        };
                    add_edge(
                        &mut edges,
                        ItemActivityEdge {
                            item_id: item.id,
                            class: class.clone(),
                            visual,
                            base_activity,
                            sequences: matching_local_sequences(model, &target_activity)?,
                            target_activity,
                            route,
                            role_source: Some(role.source.clone()),
                        },
                    )?;
                }
            }
        }
    }
    for inspect in inspect_candidates(items, models)? {
        add_edge(
            &mut edges,
            ItemActivityEdge {
                item_id: inspect.item_id,
                class: inspect.class,
                visual: inspect.visual,
                base_activity: inspect.base_activity,
                target_activity: inspect.target_activity,
                route: ActivityRoute::Inspect,
                role_source: None,
                sequences: inspect.sequences,
            },
        )?;
    }
    Ok(StockActivityGraph {
        patch_version: items.patch_version.clone(),
        edges,
        unresolved_roles,
        candidate_roles,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    use crate::viewmodel_items::StockItem;
    use crate::viewmodel_scripts::StockWeaponScript;
    use crate::viewmodel_source::{StockAnimation, StockAnimationModel, StockSequence};

    fn fixture() -> (
        StockItemCatalog,
        StockWeaponScriptIndex,
        StockAnimationIndex,
    ) {
        let item = StockItem {
            id: 1,
            name: "fixture".into(),
            item_class: "tf_weapon_fixture".into(),
            attach_to_hands: true,
            attach_to_hands_vm_only: false,
            loadout_slot: Some("primary".into()),
            class_loadout_slots: BTreeMap::from([("scout".into(), Some("primary".into()))]),
            animation_slot: Some("SECONDARY".into()),
            classes: vec!["scout".into()],
            common_replacements: BTreeMap::new(),
            red_replacements: BTreeMap::from([("ACT_VM_DRAW".into(), "ACT_ITEM1_VM_DRAW".into())]),
            blu_replacements: BTreeMap::new(),
            has_team_visuals: true,
        };
        let items = StockItemCatalog {
            patch_version: "1".into(),
            schema_sha256: "fixture".into(),
            items: BTreeMap::from([(1, item)]),
        };
        let scripts = StockWeaponScriptIndex {
            patch_version: "1".into(),
            scripts: BTreeMap::new(),
        };
        let model = StockAnimationModel {
            model_name: "fixture".into(),
            sha256: "fixture".into(),
            animations: vec![StockAnimation {
                name: "@draw".into(),
                frames: 2,
                fps: 30.0,
            }],
            sequences: ["ACT_ITEM1_VM_DRAW", "ACT_SECONDARY_VM_DRAW"]
                .into_iter()
                .map(|activity| StockSequence {
                    label: activity.into(),
                    activity: Some(activity.into()),
                    animation_indexes: vec![0],
                })
                .collect(),
        };
        let models = StockAnimationIndex {
            patch_version: "1".into(),
            models: BTreeMap::from([("scout".into(), model)]),
        };
        (items, scripts, models)
    }

    #[test]
    fn visual_replacement_precedes_role_translation_and_inspect_stays_separate() {
        let (items, scripts, models) = fixture();
        let graph = candidate_activity_graph(&items, &scripts, &models).unwrap();
        let draw = |visual| {
            graph
                .edges
                .iter()
                .find(|edge| {
                    edge.visual == visual
                        && edge.base_activity == "ACT_VM_DRAW"
                        && edge.route != ActivityRoute::Inspect
                })
                .unwrap()
        };
        assert_eq!(draw("red").target_activity, "ACT_ITEM1_VM_DRAW");
        assert_eq!(draw("red").route, ActivityRoute::ItemReplacement);
        assert_eq!(draw("red").sequences[0].animations, ["@draw"]);
        assert_eq!(draw("blu").target_activity, "ACT_SECONDARY_VM_DRAW");
        assert_eq!(draw("blu").route, ActivityRoute::RoleTable);
        assert_eq!(
            graph
                .edges
                .iter()
                .filter(|edge| edge.route == ActivityRoute::Inspect)
                .count(),
            6
        );
    }

    #[test]
    fn missing_role_keeps_explicit_visual_and_inspect_candidates() {
        let (mut items, scripts, models) = fixture();
        items.items.get_mut(&1).unwrap().animation_slot = None;
        let graph = candidate_activity_graph(&items, &scripts, &models).unwrap();
        assert_eq!(graph.unresolved_roles.len(), 1);
        assert_eq!(graph.unresolved_roles[0].item_id, 1);
        assert!(graph.edges.iter().any(|edge| {
            edge.visual == "red"
                && edge.base_activity == "ACT_VM_DRAW"
                && edge.route == ActivityRoute::ItemReplacement
        }));
        assert!(!graph.edges.iter().any(|edge| {
            edge.visual == "blu"
                && edge.base_activity == "ACT_VM_DRAW"
                && edge.route != ActivityRoute::Inspect
        }));
        assert_eq!(
            graph
                .edges
                .iter()
                .filter(|edge| edge.route == ActivityRoute::Inspect)
                .count(),
            6
        );
    }

    #[test]
    fn different_patches_are_refused() {
        let (items, mut scripts, models) = fixture();
        scripts.patch_version = "2".into();
        assert!(candidate_activity_graph(&items, &scripts, &models).is_err());
    }

    #[test]
    fn shotgun_class_script_stays_explicitly_unverified() {
        let (mut items, mut scripts, mut models) = fixture();
        let item = items.items.get_mut(&1).unwrap();
        item.item_class = "tf_weapon_shotgun".into();
        item.animation_slot = None;
        item.classes = vec!["soldier".into()];
        item.class_loadout_slots = BTreeMap::from([("soldier".into(), Some("primary".into()))]);
        let model = models.models.remove("scout").unwrap();
        models.models.insert("soldier".into(), model);
        scripts.scripts.insert(
            "tf_weapon_shotgun_soldier".into(),
            StockWeaponScript {
                path: "scripts/tf_weapon_shotgun_soldier.ctx".into(),
                sha256: "fixture".into(),
                weapon_type: Some("PRIMARY".into()),
            },
        );
        let graph = candidate_activity_graph(&items, &scripts, &models).unwrap();
        assert!(graph.unresolved_roles.is_empty());
        assert_eq!(graph.candidate_roles.len(), 1);
        assert_eq!(
            graph.candidate_roles[0].source,
            ItemRoleSource::ShotgunClassCandidate
        );
    }
}
