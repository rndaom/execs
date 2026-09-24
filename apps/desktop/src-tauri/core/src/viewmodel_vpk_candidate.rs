//! In-memory VPK candidate for independently rebuilt Viewmodels choices.
//!
//! This composes verified local class MDLs through the Full and Weapon model
//! prototypes, then round-trips the game VPK format. No path here writes to
//! TF2 or a profile. Retail validation and export policy remain separate gates.

use std::collections::{BTreeMap, BTreeSet};

use crate::hash::sha256_hex;
use crate::viewmodel_full_mdl::prototype_full_hide_mdl;
use crate::viewmodel_source::{
    parse_stock_animation_mdl, parse_stock_bone_mdl, StockAnimationModel, StockBoneModel,
    StockSourceError,
};
use crate::viewmodel_weapon_mdl::prototype_weapon_hide_mdl;
use crate::vpk::{read_vpk_dir_bytes, validate_vpk_dir_bytes_with_paths, write_vpk_v2, VpkError};

const MAX_CANDIDATE_VPK_BYTES: usize = 64 * 1024 * 1024;
const CLASSES: [&str; 9] = [
    "scout", "soldier", "pyro", "demoman", "heavy", "engineer", "medic", "sniper", "spy",
];

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HideSelection {
    pub full: BTreeSet<String>,
    pub weapon: BTreeSet<String>,
}

pub struct VerifiedClassModel<'a> {
    pub bytes: &'a [u8],
    pub animations: &'a StockAnimationModel,
    pub bones: &'a StockBoneModel,
}

fn invalid(message: impl Into<String>) -> StockSourceError {
    StockSourceError(message.into())
}

fn vpk_error(error: VpkError) -> StockSourceError {
    invalid(format!("candidate Viewmodels VPK is invalid: {}", error.0))
}

/// Assemble only explicitly selected class models. A single local animation
/// cannot be requested in both modes, because the two transforms have
/// different meanings; the eventual group resolver must surface that conflict.
/// Caller-provided indexes must bind to exact installed MDL bytes.
pub fn prototype_viewmodel_vpk(
    models: &BTreeMap<String, VerifiedClassModel<'_>>,
    selections: &BTreeMap<String, HideSelection>,
) -> Result<Vec<u8>, StockSourceError> {
    if selections.is_empty() || selections.len() > CLASSES.len() {
        return Err(invalid("candidate VPK needs one to nine selected classes"));
    }
    let mut files = BTreeMap::new();
    let mut total_model_bytes = 0usize;
    for (class, selection) in selections {
        if !CLASSES.contains(&class.as_str()) {
            return Err(invalid(format!("unknown Viewmodels class {class}")));
        }
        // The item schema and group UI use demoman; the stock model stem is demo.
        let model_key = if class == "demoman" {
            "demo"
        } else {
            class.as_str()
        };
        if selection.full.is_empty() && selection.weapon.is_empty() {
            return Err(invalid(format!("class {class} has no hide selection")));
        }
        if !selection.full.is_disjoint(&selection.weapon) {
            return Err(invalid(format!(
                "class {class} selects one animation in both hide modes"
            )));
        }
        let model = models
            .get(model_key)
            .ok_or_else(|| invalid(format!("verified class model {class} is missing")))?;
        let expected_name = format!("weapons/c_models/c_{model_key}_animations.mdl");
        if !model
            .animations
            .model_name
            .replace('\\', "/")
            .eq_ignore_ascii_case(&expected_name)
            || !model
                .bones
                .model_name
                .replace('\\', "/")
                .eq_ignore_ascii_case(&expected_name)
        {
            return Err(invalid(format!(
                "class {class} model identity is mismatched"
            )));
        }
        let fingerprint = sha256_hex(model.bytes);
        if fingerprint != model.animations.sha256 || fingerprint != model.bones.sha256 {
            return Err(invalid(format!(
                "class {class} model bytes differ from their verified indexes"
            )));
        }
        let mut candidate = if selection.full.is_empty() {
            model.bytes.to_vec()
        } else {
            prototype_full_hide_mdl(model.bytes, model.animations, model.bones, &selection.full)?
        };
        if !selection.weapon.is_empty() {
            let animations = parse_stock_animation_mdl(&candidate)?;
            let bones = parse_stock_bone_mdl(&candidate)?;
            if animations.animations != model.animations.animations
                || animations.sequences != model.animations.sequences
                || bones.bones != model.bones.bones
            {
                return Err(invalid(format!(
                    "class {class} model changed metadata before Weapon mode"
                )));
            }
            candidate =
                prototype_weapon_hide_mdl(&candidate, &animations, &bones, &selection.weapon)?;
        }
        total_model_bytes = total_model_bytes
            .checked_add(candidate.len())
            .filter(|total| *total <= MAX_CANDIDATE_VPK_BYTES)
            .ok_or_else(|| invalid("candidate Viewmodels models exceed the pack limit"))?;
        let path = format!("models/weapons/c_models/c_{model_key}_animations.mdl");
        files.insert(path, candidate);
    }
    let packed = write_vpk_v2(&files);
    if packed.len() > MAX_CANDIDATE_VPK_BYTES {
        return Err(invalid("candidate Viewmodels VPK exceeds the pack limit"));
    }
    let mut seen = BTreeSet::new();
    validate_vpk_dir_bytes_with_paths(&packed, &mut |path| {
        if !files.contains_key(path) || !seen.insert(path.to_string()) {
            return Err(VpkError(format!("unexpected Viewmodels VPK member {path}")));
        }
        Ok(())
    })
    .map_err(vpk_error)?;
    if seen.len() != files.len() || read_vpk_dir_bytes(&packed).map_err(vpk_error)?.files != files {
        return Err(invalid(
            "candidate Viewmodels VPK did not round-trip exactly",
        ));
    }
    Ok(packed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_empty_unknown_and_conflicting_requests_before_a_pack() {
        let models = BTreeMap::new();
        assert!(prototype_viewmodel_vpk(&models, &BTreeMap::new()).is_err());
        assert!(prototype_viewmodel_vpk(
            &models,
            &BTreeMap::from([(
                "scout".into(),
                HideSelection {
                    full: BTreeSet::from(["@draw".into()]),
                    weapon: BTreeSet::from(["@draw".into()]),
                }
            )])
        )
        .unwrap_err()
        .0
        .contains("both hide modes"));
        assert!(prototype_viewmodel_vpk(
            &models,
            &BTreeMap::from([(
                "other".into(),
                HideSelection {
                    full: BTreeSet::from(["@draw".into()]),
                    weapon: BTreeSet::new(),
                }
            )])
        )
        .is_err());
    }

    #[test]
    fn refuses_weapon_only_source_with_a_changed_fingerprint() {
        let model_name = "weapons/c_models/c_scout_animations.mdl".to_string();
        let animations = StockAnimationModel {
            model_name: model_name.clone(),
            sha256: "stale".into(),
            animations: Vec::new(),
            sequences: Vec::new(),
        };
        let bones = StockBoneModel {
            model_name,
            sha256: "stale".into(),
            bones: Vec::new(),
        };
        let result = prototype_viewmodel_vpk(
            &BTreeMap::from([(
                "scout".into(),
                VerifiedClassModel {
                    bytes: b"changed",
                    animations: &animations,
                    bones: &bones,
                },
            )]),
            &BTreeMap::from([(
                "scout".into(),
                HideSelection {
                    full: BTreeSet::new(),
                    weapon: BTreeSet::from(["@draw".into()]),
                },
            )]),
        );
        assert!(result.unwrap_err().0.contains("verified indexes"));
    }
}
