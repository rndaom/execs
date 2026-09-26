//! Resolve provisional Viewmodels groups into local-animation hide selections.
//!
//! The catalog identity binds a request to the TF2 patch and the complete
//! candidate membership. It is not a proof that a group renders correctly in
//! retail TF2 or a fingerprint of the installed MDL bytes.

use std::collections::{BTreeMap, BTreeSet};

use crate::hash::sha256_hex;
use crate::viewmodel_groups::{
    group_id, ViewmodelGroupCandidate, ViewmodelGroupCandidates, MAX_ANIMATIONS_PER_GROUP,
    MAX_GROUPS,
};
use crate::viewmodel_source::StockSourceError;
use crate::viewmodel_vpk_candidate::{HideSelection, CLASSES};

const CATALOG_IDENTITY_DOMAIN: &str = "execs:provisional-viewmodel-groups:v1";
const MAX_ITEMS_PER_GROUP: usize = 100_000;
const MAX_UNRESOLVED_ITEMS: usize = 100_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProvisionalGroupCatalogIdentity {
    pub patch_version: String,
    pub catalog_sha256: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProvisionalHideMode {
    Full,
    Weapon,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProvisionalGroupChoice {
    pub group_id: String,
    pub mode: ProvisionalHideMode,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProvisionalGroupRequest {
    /// Capture this identity when forming the request from the candidate catalog.
    pub catalog: ProvisionalGroupCatalogIdentity,
    pub choices: Vec<ProvisionalGroupChoice>,
}

fn invalid(message: impl Into<String>) -> StockSourceError {
    StockSourceError(message.into())
}

fn push_bytes(out: &mut Vec<u8>, value: &[u8]) {
    out.extend_from_slice(&(value.len() as u64).to_le_bytes());
    out.extend_from_slice(value);
}

fn push_str(out: &mut Vec<u8>, value: &str) {
    push_bytes(out, value.as_bytes());
}

fn push_len(out: &mut Vec<u8>, value: usize) {
    out.extend_from_slice(&(value as u64).to_le_bytes());
}

fn validate_group(group: &ViewmodelGroupCandidate) -> Result<(), StockSourceError> {
    if !CLASSES.contains(&group.class.as_str()) {
        return Err(invalid(format!(
            "provisional Viewmodels group has unknown class {}",
            group.class
        )));
    }
    if group.animations.is_empty() || group.animations.len() > MAX_ANIMATIONS_PER_GROUP {
        return Err(invalid(format!(
            "provisional Viewmodels group {} has invalid animation count",
            group.id
        )));
    }
    if group
        .animations
        .iter()
        .any(|animation| animation.is_empty() || animation.contains('\0'))
        || group.animations.windows(2).any(|pair| pair[0] >= pair[1])
    {
        return Err(invalid(format!(
            "provisional Viewmodels group {} has noncanonical animations",
            group.id
        )));
    }
    if group.id != group_id(&group.class, group.inspect, &group.animations) {
        return Err(invalid(format!(
            "provisional Viewmodels group {} has a stale ID",
            group.id
        )));
    }
    if group.item_ids.is_empty()
        || group.item_ids.len() > MAX_ITEMS_PER_GROUP
        || group.item_ids.windows(2).any(|pair| pair[0] >= pair[1])
    {
        return Err(invalid(format!(
            "provisional Viewmodels group {} has noncanonical items",
            group.id
        )));
    }
    Ok(())
}

/// Compute the identity for choices made from this exact provisional
/// catalog. A change to item membership, animations, or the patch invalidates
/// the request even when an individual group ID stays the same.
pub fn provisional_group_catalog_identity(
    catalog: &ViewmodelGroupCandidates,
) -> Result<ProvisionalGroupCatalogIdentity, StockSourceError> {
    if catalog.patch_version.is_empty()
        || catalog.patch_version.len() > 128
        || catalog.patch_version.contains('\0')
        || catalog.groups.len() > MAX_GROUPS
        || catalog.unresolved_items.len() > MAX_UNRESOLVED_ITEMS
    {
        return Err(invalid("provisional Viewmodels catalog is invalid"));
    }
    let mut groups = BTreeMap::<&str, &ViewmodelGroupCandidate>::new();
    for group in &catalog.groups {
        validate_group(group)?;
        if groups.insert(&group.id, group).is_some() {
            return Err(invalid(format!(
                "provisional Viewmodels catalog repeats group {}",
                group.id
            )));
        }
    }
    let mut bytes = Vec::new();
    push_str(&mut bytes, CATALOG_IDENTITY_DOMAIN);
    push_str(&mut bytes, &catalog.patch_version);
    push_len(&mut bytes, groups.len());
    for group in groups.values() {
        push_str(&mut bytes, &group.id);
        push_str(&mut bytes, &group.class);
        bytes.push(u8::from(group.inspect));
        push_len(&mut bytes, group.item_ids.len());
        for item_id in &group.item_ids {
            bytes.extend_from_slice(&item_id.to_le_bytes());
        }
        push_len(&mut bytes, group.animations.len());
        for animation in &group.animations {
            push_str(&mut bytes, animation);
        }
        let overlaps: BTreeSet<_> = group.overlaps.iter().collect();
        if group.overlaps.len() > MAX_GROUPS - 1
            || overlaps.len() != group.overlaps.len()
            || overlaps.iter().any(|id| !groups.contains_key(id.as_str()))
        {
            return Err(invalid(format!(
                "provisional Viewmodels group {} has invalid overlap IDs",
                group.id
            )));
        }
        push_len(&mut bytes, overlaps.len());
        for overlap in overlaps {
            push_str(&mut bytes, overlap);
        }
        bytes.push(u8::from(group.team_variants_differ));
    }
    let unresolved: BTreeSet<_> = catalog.unresolved_items.iter().collect();
    if unresolved.len() != catalog.unresolved_items.len() {
        return Err(invalid(
            "provisional Viewmodels catalog repeats an unresolved item",
        ));
    }
    push_len(&mut bytes, unresolved.len());
    for (class, item_id) in unresolved {
        push_str(&mut bytes, class);
        bytes.extend_from_slice(&item_id.to_le_bytes());
    }
    Ok(ProvisionalGroupCatalogIdentity {
        patch_version: catalog.patch_version.clone(),
        catalog_sha256: sha256_hex(&bytes),
    })
}

/// Convert group IDs into the per-class animation sets accepted by
/// `prototype_viewmodel_vpk`. Same-mode overlaps collapse to one animation;
/// requests that would apply both transforms to one animation are refused.
pub fn resolve_provisional_group_selection(
    catalog: &ViewmodelGroupCandidates,
    request: &ProvisionalGroupRequest,
) -> Result<BTreeMap<String, HideSelection>, StockSourceError> {
    let current_identity = provisional_group_catalog_identity(catalog)?;
    if request.catalog != current_identity {
        return Err(invalid(
            "provisional Viewmodels group catalog changed; refresh the selection",
        ));
    }
    if request.choices.is_empty() || request.choices.len() > MAX_GROUPS * 2 {
        return Err(invalid(
            "provisional Viewmodels selection needs one to 2048 group choices",
        ));
    }
    let by_id: BTreeMap<_, _> = catalog
        .groups
        .iter()
        .map(|group| (group.id.as_str(), group))
        .collect();
    let mut group_modes = BTreeMap::new();
    let mut by_class = BTreeMap::<String, HideSelection>::new();
    for choice in &request.choices {
        let group = by_id.get(choice.group_id.as_str()).ok_or_else(|| {
            invalid(format!(
                "provisional Viewmodels group {} is unknown or stale",
                choice.group_id
            ))
        })?;
        if let Some(prior_mode) = group_modes.insert(&choice.group_id, choice.mode) {
            if prior_mode != choice.mode {
                return Err(invalid(format!(
                    "provisional Viewmodels group {} is requested in both modes",
                    choice.group_id
                )));
            }
        }
        let class_selection = by_class.entry(group.class.clone()).or_default();
        let (selected, opposite) = match choice.mode {
            ProvisionalHideMode::Full => (&mut class_selection.full, &class_selection.weapon),
            ProvisionalHideMode::Weapon => (&mut class_selection.weapon, &class_selection.full),
        };
        for animation in &group.animations {
            if opposite.contains(animation) {
                return Err(invalid(format!(
                    "class {} animation {animation} is selected in both hide modes",
                    group.class
                )));
            }
            selected.insert(animation.clone());
        }
    }
    Ok(by_class)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn group(class: &str, item_ids: &[u32], animations: &[&str]) -> ViewmodelGroupCandidate {
        let animations: Vec<String> = animations.iter().map(|name| (*name).into()).collect();
        ViewmodelGroupCandidate {
            id: group_id(class, false, &animations),
            class: class.into(),
            item_ids: item_ids.to_vec(),
            animations,
            inspect: false,
            overlaps: Vec::new(),
            team_variants_differ: false,
        }
    }

    fn catalog() -> ViewmodelGroupCandidates {
        ViewmodelGroupCandidates {
            patch_version: "10828683".into(),
            groups: vec![
                group("scout", &[1], &["@a", "@shared"]),
                group("scout", &[2], &["@b", "@shared"]),
                group("demoman", &[3], &["@demo"]),
            ],
            unresolved_items: vec![("spy".into(), 1155)],
        }
    }

    fn request(
        catalog: &ViewmodelGroupCandidates,
        choices: Vec<ProvisionalGroupChoice>,
    ) -> ProvisionalGroupRequest {
        ProvisionalGroupRequest {
            catalog: provisional_group_catalog_identity(catalog).unwrap(),
            choices,
        }
    }

    fn choice(
        group: &ViewmodelGroupCandidate,
        mode: ProvisionalHideMode,
    ) -> ProvisionalGroupChoice {
        ProvisionalGroupChoice {
            group_id: group.id.clone(),
            mode,
        }
    }

    #[test]
    fn same_mode_overlaps_and_duplicate_choices_resolve_once_per_class() {
        let catalog = catalog();
        let result = resolve_provisional_group_selection(
            &catalog,
            &request(
                &catalog,
                vec![
                    choice(&catalog.groups[0], ProvisionalHideMode::Full),
                    choice(&catalog.groups[1], ProvisionalHideMode::Full),
                    choice(&catalog.groups[0], ProvisionalHideMode::Full),
                    choice(&catalog.groups[2], ProvisionalHideMode::Weapon),
                ],
            ),
        )
        .unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(
            result["scout"].full,
            BTreeSet::from(["@a".into(), "@b".into(), "@shared".into()])
        );
        assert!(result["scout"].weapon.is_empty());
        assert_eq!(result["demoman"].weapon, BTreeSet::from(["@demo".into()]));
    }

    #[test]
    fn conflicting_overlaps_and_contradictory_duplicate_requests_fail() {
        let catalog = catalog();
        let overlap = request(
            &catalog,
            vec![
                choice(&catalog.groups[0], ProvisionalHideMode::Full),
                choice(&catalog.groups[1], ProvisionalHideMode::Weapon),
            ],
        );
        assert!(resolve_provisional_group_selection(&catalog, &overlap)
            .unwrap_err()
            .0
            .contains("animation @shared"));
        let duplicate = request(
            &catalog,
            vec![
                choice(&catalog.groups[0], ProvisionalHideMode::Full),
                choice(&catalog.groups[0], ProvisionalHideMode::Weapon),
            ],
        );
        assert!(resolve_provisional_group_selection(&catalog, &duplicate)
            .unwrap_err()
            .0
            .contains("requested in both modes"));
    }

    #[test]
    fn stale_catalog_membership_patch_and_unknown_ids_fail() {
        let catalog = catalog();
        let original_request = request(
            &catalog,
            vec![choice(&catalog.groups[0], ProvisionalHideMode::Full)],
        );
        let mut changed_membership = catalog.clone();
        changed_membership.groups[0].item_ids = vec![4];
        assert!(
            resolve_provisional_group_selection(&changed_membership, &original_request)
                .unwrap_err()
                .0
                .contains("catalog changed")
        );
        let mut changed_patch = catalog.clone();
        changed_patch.patch_version = "next".into();
        assert!(
            resolve_provisional_group_selection(&changed_patch, &original_request)
                .unwrap_err()
                .0
                .contains("catalog changed")
        );
        let unknown = request(
            &catalog,
            vec![ProvisionalGroupChoice {
                group_id: "scout/old".into(),
                mode: ProvisionalHideMode::Full,
            }],
        );
        assert!(resolve_provisional_group_selection(&catalog, &unknown)
            .unwrap_err()
            .0
            .contains("unknown or stale"));
    }

    #[test]
    fn catalog_rejects_a_forged_or_duplicate_group_id() {
        let mut forged_catalog = catalog();
        forged_catalog.groups[0].id = "scout/old".into();
        assert!(provisional_group_catalog_identity(&forged_catalog)
            .unwrap_err()
            .0
            .contains("stale ID"));
        let mut catalog = catalog();
        catalog.groups.push(catalog.groups[0].clone());
        assert!(provisional_group_catalog_identity(&catalog)
            .unwrap_err()
            .0
            .contains("repeats group"));
    }

    #[test]
    fn catalog_identity_ignores_group_display_order() {
        let catalog = catalog();
        let mut reordered = catalog.clone();
        reordered.groups.reverse();
        assert_eq!(
            provisional_group_catalog_identity(&catalog).unwrap(),
            provisional_group_catalog_identity(&reordered).unwrap()
        );
    }
}
