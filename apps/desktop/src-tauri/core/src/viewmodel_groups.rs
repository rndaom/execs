//! Independent, provisional group candidates from installed Viewmodels links.
//!
//! Equal direct local-animation sets are grouped within a class. Shared local
//! animations remain visible as conflicts: choosing one candidate may affect
//! another. These are not yet retail-verified selectable builder groups.

use std::collections::{BTreeMap, BTreeSet};

use crate::hash::sha256_hex;
use crate::viewmodel_graph::{ActivityRoute, StockActivityGraph};
use crate::viewmodel_source::StockSourceError;

pub(crate) const MAX_GROUPS: usize = 1024;
pub(crate) const MAX_ANIMATIONS_PER_GROUP: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ViewmodelGroupCandidate {
    /// Content identity, independent of item ordering and the retired table.
    pub id: String,
    pub class: String,
    pub item_ids: Vec<u32>,
    pub animations: Vec<String>,
    /// Groups in the same class that use at least one of these animations.
    pub overlaps: Vec<String>,
    /// At least one item's RED and BLU direct local-animation sets differ.
    pub team_variants_differ: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ViewmodelGroupCandidates {
    pub patch_version: String,
    pub groups: Vec<ViewmodelGroupCandidate>,
    /// Shared-hands item/class pairs without a source-backed direct sequence.
    pub unresolved_items: Vec<(String, u32)>,
}

pub(crate) fn group_id(class: &str, animations: &[String]) -> String {
    let mut identity = Vec::new();
    identity.extend_from_slice(class.as_bytes());
    identity.push(0);
    for animation in animations {
        identity.extend_from_slice(animation.as_bytes());
        identity.push(0);
    }
    format!("{class}/{}", sha256_hex(&identity))
}

/// Cluster item/class candidates by their direct local-animation names.
/// Role-identity fallbacks are omitted until runtime routing is verified.
/// Repeated sequence blend references reduce to one animation name here,
/// while the source graph keeps every blend reference for the eventual build.
pub fn derive_group_candidates(
    graph: &StockActivityGraph,
) -> Result<ViewmodelGroupCandidates, StockSourceError> {
    let mut by_item = BTreeMap::<(String, u32), BTreeMap<&'static str, BTreeSet<String>>>::new();
    for edge in &graph.edges {
        let team = by_item
            .entry((edge.class.clone(), edge.item_id))
            .or_default()
            .entry(edge.visual)
            .or_default();
        if edge.route == ActivityRoute::RoleIdentity {
            continue;
        }
        for sequence in &edge.sequences {
            team.extend(sequence.animations.iter().cloned());
            if team.len() > MAX_ANIMATIONS_PER_GROUP {
                return Err(StockSourceError(format!(
                    "item {} has too many Viewmodels animation candidates",
                    edge.item_id
                )));
            }
        }
    }

    let mut clusters = BTreeMap::<(String, Vec<String>), (BTreeSet<u32>, bool)>::new();
    let mut unresolved_items = Vec::new();
    for ((class, item_id), visuals) in by_item {
        let team_variants_differ = visuals.get("red") != visuals.get("blu");
        let animations: Vec<String> = visuals
            .into_values()
            .flatten()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        if animations.is_empty() {
            unresolved_items.push((class, item_id));
            continue;
        }
        let cluster = clusters.entry((class, animations)).or_default();
        cluster.0.insert(item_id);
        cluster.1 |= team_variants_differ;
        if clusters.len() > MAX_GROUPS {
            return Err(StockSourceError(
                "Viewmodels candidate group count exceeds the limit".into(),
            ));
        }
    }

    let mut groups: Vec<_> = clusters
        .into_iter()
        .map(
            |((class, animations), (item_ids, team_variants_differ))| ViewmodelGroupCandidate {
                id: group_id(&class, &animations),
                class,
                item_ids: item_ids.into_iter().collect(),
                animations,
                overlaps: Vec::new(),
                team_variants_differ,
            },
        )
        .collect();
    let mut animation_owners = BTreeMap::<(String, String), Vec<usize>>::new();
    for (group_index, group) in groups.iter().enumerate() {
        for animation in &group.animations {
            animation_owners
                .entry((group.class.clone(), animation.clone()))
                .or_default()
                .push(group_index);
        }
    }
    let mut overlaps = vec![BTreeSet::<usize>::new(); groups.len()];
    for owners in animation_owners.values() {
        for &left in owners {
            overlaps[left].extend(owners.iter().copied().filter(|right| *right != left));
        }
    }
    for (group_index, other_indexes) in overlaps.into_iter().enumerate() {
        groups[group_index].overlaps = other_indexes
            .into_iter()
            .map(|other| groups[other].id.clone())
            .collect();
    }
    Ok(ViewmodelGroupCandidates {
        patch_version: graph.patch_version.clone(),
        groups,
        unresolved_items,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::viewmodel_graph::{ItemActivityEdge, StockActivityGraph};
    use crate::viewmodel_items::CandidateSequence;

    fn edge(
        item_id: u32,
        visual: &'static str,
        animation: &str,
        route: ActivityRoute,
    ) -> ItemActivityEdge {
        ItemActivityEdge {
            item_id,
            class: "scout".into(),
            visual,
            base_activity: "ACT_VM_DRAW".into(),
            target_activity: "ACT_PRIMARY_VM_DRAW".into(),
            route,
            role_source: None,
            sequences: vec![CandidateSequence {
                label: "draw".into(),
                animations: vec![animation.into()],
            }],
        }
    }

    #[test]
    fn equal_sets_cluster_and_shared_animations_report_conflicts() {
        let graph = StockActivityGraph {
            patch_version: "1".into(),
            edges: vec![
                edge(1, "red", "@a", ActivityRoute::RoleTable),
                edge(1, "blu", "@a", ActivityRoute::RoleTable),
                edge(2, "red", "@a", ActivityRoute::ItemReplacement),
                edge(2, "blu", "@a", ActivityRoute::ItemReplacement),
                edge(3, "red", "@a", ActivityRoute::RoleTable),
                edge(3, "red", "@b", ActivityRoute::Inspect),
                edge(3, "blu", "@a", ActivityRoute::RoleTable),
                edge(3, "blu", "@b", ActivityRoute::Inspect),
                edge(4, "red", "@ignored", ActivityRoute::RoleIdentity),
            ],
            unresolved_roles: Vec::new(),
            candidate_roles: Vec::new(),
        };
        let result = derive_group_candidates(&graph).unwrap();
        assert_eq!(result.groups.len(), 2);
        assert_eq!(result.groups[0].item_ids, [1, 2]);
        assert_eq!(result.groups[0].animations, ["@a"]);
        assert_eq!(result.groups[1].item_ids, [3]);
        assert_eq!(result.groups[1].animations, ["@a", "@b"]);
        assert_eq!(result.groups[0].overlaps, [result.groups[1].id.clone()]);
        assert_eq!(result.groups[1].overlaps, [result.groups[0].id.clone()]);
        assert_eq!(result.unresolved_items, [("scout".into(), 4)]);
    }

    #[test]
    fn team_variation_is_preserved_in_the_union() {
        let graph = StockActivityGraph {
            patch_version: "1".into(),
            edges: vec![
                edge(1, "red", "@red", ActivityRoute::ItemReplacement),
                edge(1, "blu", "@blu", ActivityRoute::ItemReplacement),
            ],
            unresolved_roles: Vec::new(),
            candidate_roles: Vec::new(),
        };
        let result = derive_group_candidates(&graph).unwrap();
        assert_eq!(result.groups[0].animations, ["@blu", "@red"]);
        assert!(result.groups[0].team_variants_differ);
    }
}
