//! Structural preflight for provisional Viewmodels hide groups.
//!
//! This measures which installed local animations have a simple raw-position
//! record path. It does not decode payloads, transform models, or establish
//! that a candidate will render correctly in TF2.

use std::collections::BTreeMap;

use crate::viewmodel_groups::ViewmodelGroupCandidates;
use crate::viewmodel_pose::{AnimationPoseSummary, PositionEncodings, StockPoseIndex};
use crate::viewmodel_source::{StockAnimationIndex, StockSourceError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HideMode {
    Full,
    Weapon,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PoseRoute {
    /// Record headers suggest a raw-position path; payload and rendering are
    /// still unverified, so this is not build-ready.
    RawCandidate,
    SpecialAnimation,
    MissingAnimation,
    NoWeaponBones,
    MissingPositionRecords,
    CompressedPosition,
    UnboundedTail,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnimationTransformCandidate {
    pub name: String,
    pub route: PoseRoute,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GroupTransformCandidate {
    pub group_id: String,
    pub class: String,
    pub mode: HideMode,
    pub animations: Vec<AnimationTransformCandidate>,
}

fn route(counts: &PositionEncodings, expected_records: usize) -> PoseRoute {
    if counts.unbounded_tail > 0 {
        PoseRoute::UnboundedTail
    } else if counts.compressed > 0 {
        PoseRoute::CompressedPosition
    } else if counts.none > 0 || counts.raw != expected_records {
        PoseRoute::MissingPositionRecords
    } else {
        PoseRoute::RawCandidate
    }
}

fn animation_route(
    name: &str,
    mode: HideMode,
    pose: &StockPoseIndex,
    by_name: &BTreeMap<&str, &AnimationPoseSummary>,
) -> PoseRoute {
    let Some(animation) = by_name.get(name) else {
        return PoseRoute::MissingAnimation;
    };
    if animation.unsupported_reason.is_some() || animation.section_count == 0 {
        return PoseRoute::SpecialAnimation;
    }
    match mode {
        HideMode::Full => route(&animation.root, animation.section_count),
        HideMode::Weapon if pose.weapon_bones.is_empty() => PoseRoute::NoWeaponBones,
        HideMode::Weapon => route(
            &animation.weapon,
            animation.section_count * pose.weapon_bones.len(),
        ),
    }
}

/// Assess every provisional class group against verified pose-record metadata.
/// This intentionally gives no "safe to build" verdict: raw record payloads,
/// sequence weights, included models and retail rendering remain open.
pub fn assess_transform_candidates(
    groups: &ViewmodelGroupCandidates,
    animation_index: &StockAnimationIndex,
    pose_indexes: &BTreeMap<String, StockPoseIndex>,
    mode: HideMode,
) -> Result<Vec<GroupTransformCandidate>, StockSourceError> {
    if groups.patch_version != animation_index.patch_version {
        return Err(StockSourceError(
            "Viewmodels groups and class MDLs come from different TF2 patches".into(),
        ));
    }
    let mut out = Vec::with_capacity(groups.groups.len());
    for group in &groups.groups {
        let model_id = if group.class == "demoman" {
            "demo"
        } else {
            group.class.as_str()
        };
        let animation_model = animation_index.models.get(model_id).ok_or_else(|| {
            StockSourceError(format!("class {} animation model is missing", group.class))
        })?;
        let pose = pose_indexes.get(model_id).ok_or_else(|| {
            StockSourceError(format!("class {} pose inventory is missing", group.class))
        })?;
        if pose.sha256 != animation_model.sha256 || pose.model_name != animation_model.model_name {
            return Err(StockSourceError(format!(
                "class {} pose inventory differs from its stock MDL",
                group.class
            )));
        }
        let by_name: BTreeMap<_, _> = pose
            .animations
            .iter()
            .map(|animation| (animation.name.as_str(), animation))
            .collect();
        if by_name.len() != pose.animations.len() {
            return Err(StockSourceError(format!(
                "class {} pose inventory has duplicate animations",
                group.class
            )));
        }
        out.push(GroupTransformCandidate {
            group_id: group.id.clone(),
            class: group.class.clone(),
            mode,
            animations: group
                .animations
                .iter()
                .map(|name| AnimationTransformCandidate {
                    name: name.clone(),
                    route: animation_route(name, mode, pose, &by_name),
                })
                .collect(),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::viewmodel_groups::ViewmodelGroupCandidate;
    use crate::viewmodel_source::StockAnimationModel;

    fn fixture() -> (
        ViewmodelGroupCandidates,
        StockAnimationIndex,
        BTreeMap<String, StockPoseIndex>,
    ) {
        let groups = ViewmodelGroupCandidates {
            patch_version: "1".into(),
            groups: vec![ViewmodelGroupCandidate {
                id: "demoman/example".into(),
                class: "demoman".into(),
                item_ids: vec![1],
                animations: vec!["@raw".into(), "@compressed".into(), "@missing".into()],
                overlaps: Vec::new(),
                team_variants_differ: false,
            }],
            unresolved_items: Vec::new(),
        };
        let animation = StockAnimationIndex {
            patch_version: "1".into(),
            models: BTreeMap::from([(
                "demo".into(),
                StockAnimationModel {
                    model_name: "fixture".into(),
                    sha256: "fixture-hash".into(),
                    animations: Vec::new(),
                    sequences: Vec::new(),
                },
            )]),
        };
        let raw = AnimationPoseSummary {
            name: "@raw".into(),
            section_count: 2,
            bone_records: 4,
            root: PositionEncodings {
                raw: 2,
                ..Default::default()
            },
            weapon: PositionEncodings {
                raw: 2,
                ..Default::default()
            },
            unknown_flag_records: 0,
            unsupported_reason: None,
        };
        let compressed = AnimationPoseSummary {
            name: "@compressed".into(),
            root: PositionEncodings {
                raw: 1,
                compressed: 1,
                ..Default::default()
            },
            weapon: PositionEncodings {
                raw: 1,
                unbounded_tail: 1,
                ..Default::default()
            },
            ..raw.clone()
        };
        let poses = BTreeMap::from([(
            "demo".into(),
            StockPoseIndex {
                model_name: "fixture".into(),
                sha256: "fixture-hash".into(),
                weapon_bones: vec!["weapon_bone_L".into()],
                animations: vec![raw, compressed],
                shared_chain_starts: 0,
            },
        )]);
        (groups, animation, poses)
    }

    #[test]
    fn class_alias_and_mode_requirements_stay_distinct() {
        let (groups, animation, poses) = fixture();
        let full =
            assess_transform_candidates(&groups, &animation, &poses, HideMode::Full).unwrap();
        let weapon =
            assess_transform_candidates(&groups, &animation, &poses, HideMode::Weapon).unwrap();
        assert_eq!(full[0].animations[0].route, PoseRoute::RawCandidate);
        assert_eq!(full[0].animations[1].route, PoseRoute::CompressedPosition);
        assert_eq!(full[0].animations[2].route, PoseRoute::MissingAnimation);
        assert_eq!(weapon[0].animations[0].route, PoseRoute::RawCandidate);
        assert_eq!(weapon[0].animations[1].route, PoseRoute::UnboundedTail);
    }

    #[test]
    fn patch_and_model_mismatches_refuse_a_candidate_report() {
        let (mut groups, animation, mut poses) = fixture();
        groups.patch_version = "2".into();
        assert!(assess_transform_candidates(&groups, &animation, &poses, HideMode::Full).is_err());
        groups.patch_version = "1".into();
        poses.get_mut("demo").unwrap().sha256 = "changed".into();
        assert!(assess_transform_candidates(&groups, &animation, &poses, HideMode::Full).is_err());
    }
}
