//! Read-only inspect activity candidates from installed class loadout slots.
//!
//! Valve's `CTFWeaponBase::GetInspectActivity` selects the primary, secondary,
//! melee, or building family from `GetLoadoutSlot(iClass)`, with primary as the
//! fallback. Effective team item visuals can then replace that activity.
//! This module reports source candidates; it cannot establish that an item
//! can inspect or that retail TF2 will play a particular sequence.

use crate::viewmodel_items::{matching_local_sequences, CandidateSequence, StockItemCatalog};
use crate::viewmodel_source::{StockAnimationIndex, StockSourceError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InspectStage {
    Start,
    Idle,
    End,
}

impl InspectStage {
    const ALL: [Self; 3] = [Self::Start, Self::Idle, Self::End];

    fn suffix(self) -> &'static str {
        match self {
            Self::Start => "START",
            Self::Idle => "IDLE",
            Self::End => "END",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InspectCandidate {
    pub item_id: u32,
    pub class: String,
    /// Effective installed RED or BLU item visual.
    pub visual: &'static str,
    pub loadout_slot: Option<String>,
    pub stage: InspectStage,
    pub base_activity: String,
    pub target_activity: String,
    /// Empty when the stock class MDL has no direct target sequence.
    pub sequences: Vec<CandidateSequence>,
}

/// The SDK's inspect table, including its primary fallback for other slots.
pub fn inspect_activity(slot: Option<&str>, stage: InspectStage) -> String {
    let family = match slot {
        Some("secondary") => "SECONDARY",
        Some("melee") => "MELEE",
        Some("building") => "BUILDING",
        _ => "PRIMARY",
    };
    format!("ACT_{family}_VM_INSPECT_{}", stage.suffix())
}

/// Link the installed weapon definitions to direct stock class-MDL sequences.
/// The item-schema class is only a candidate for `CTFWeaponBase` routing; this
/// does not account for `CanInspect`, runtime model choice, or item overrides.
pub fn inspect_candidates(
    items: &StockItemCatalog,
    models: &StockAnimationIndex,
) -> Result<Vec<InspectCandidate>, StockSourceError> {
    if items.patch_version != models.patch_version {
        return Err(StockSourceError(
            "item schema and MDLs come from different TF2 patches".into(),
        ));
    }
    let mut out = Vec::new();
    for item in items.items.values() {
        if !item
            .item_class
            .to_ascii_lowercase()
            .starts_with("tf_weapon_")
            || !item.attach_to_hands
        {
            continue;
        }
        for (class, slot) in &item.class_loadout_slots {
            let model_id = if class == "demoman" { "demo" } else { class };
            let model = models.models.get(model_id).ok_or_else(|| {
                StockSourceError(format!("class {class} animation model is missing"))
            })?;
            for (visual, replacements) in [
                ("red", &item.red_replacements),
                ("blu", &item.blu_replacements),
            ] {
                for stage in InspectStage::ALL {
                    let base_activity = inspect_activity(slot.as_deref(), stage);
                    // Item activity replacement runs before the role table;
                    // the table has no inspect entry, so this is the target.
                    let target_activity = replacements
                        .get(&base_activity)
                        .cloned()
                        .unwrap_or_else(|| base_activity.clone());
                    out.push(InspectCandidate {
                        item_id: item.id,
                        class: class.clone(),
                        visual,
                        loadout_slot: slot.clone(),
                        stage,
                        sequences: matching_local_sequences(model, &target_activity)?,
                        base_activity,
                        target_activity,
                    });
                }
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    use crate::viewmodel_items::StockItem;
    use crate::viewmodel_source::{StockAnimation, StockAnimationModel, StockSequence};

    #[test]
    fn inspect_uses_class_slot_and_primary_fallback() {
        for (slot, family) in [
            (Some("primary"), "PRIMARY"),
            (Some("secondary"), "SECONDARY"),
            (Some("melee"), "MELEE"),
            (Some("building"), "BUILDING"),
            (Some("pda"), "PRIMARY"),
            (None, "PRIMARY"),
        ] {
            for (stage, suffix) in [
                (InspectStage::Start, "START"),
                (InspectStage::Idle, "IDLE"),
                (InspectStage::End, "END"),
            ] {
                assert_eq!(
                    inspect_activity(slot, stage),
                    format!("ACT_{family}_VM_INSPECT_{suffix}")
                );
            }
        }
    }

    #[test]
    fn reports_direct_sequences_for_each_class_slot_without_inventing_missing_ones() {
        let item = StockItem {
            id: 42,
            name: "example".into(),
            item_class: "tf_weapon_example".into(),
            attach_to_hands: true,
            attach_to_hands_vm_only: false,
            loadout_slot: Some("primary".into()),
            class_loadout_slots: BTreeMap::from([
                ("scout".into(), Some("primary".into())),
                ("soldier".into(), Some("secondary".into())),
            ]),
            animation_slot: None,
            classes: vec!["scout".into(), "soldier".into()],
            common_replacements: BTreeMap::new(),
            red_replacements: BTreeMap::from([(
                "ACT_PRIMARY_VM_INSPECT_START".into(),
                "ACT_PRIMARY_ALT1_VM_INSPECT_START".into(),
            )]),
            blu_replacements: BTreeMap::new(),
            has_team_visuals: false,
        };
        let mut separate_model = item.clone();
        separate_model.id = 43;
        separate_model.attach_to_hands = false;
        let items = StockItemCatalog {
            patch_version: "1".into(),
            schema_sha256: "hash".into(),
            items: BTreeMap::from([(42, item), (43, separate_model)]),
        };
        let model = |activities: &[&str]| StockAnimationModel {
            model_name: "example".into(),
            sha256: "hash".into(),
            animations: vec![StockAnimation {
                name: "example_anim".into(),
                frames: 2,
                fps: 30.0,
            }],
            sequences: activities
                .iter()
                .map(|activity| StockSequence {
                    label: activity.to_string(),
                    activity: Some(activity.to_string()),
                    animation_indexes: vec![0],
                })
                .collect(),
        };
        let models = StockAnimationIndex {
            patch_version: "1".into(),
            models: BTreeMap::from([
                (
                    "scout".into(),
                    model(&[
                        "ACT_PRIMARY_VM_INSPECT_START",
                        "ACT_PRIMARY_ALT1_VM_INSPECT_START",
                    ]),
                ),
                ("soldier".into(), model(&["ACT_SECONDARY_VM_INSPECT_START"])),
            ]),
        };
        let found = inspect_candidates(&items, &models).unwrap();
        assert_eq!(found.len(), 12);
        assert_eq!(found[0].visual, "red");
        assert_eq!(found[0].base_activity, "ACT_PRIMARY_VM_INSPECT_START");
        assert_eq!(
            found[0].target_activity,
            "ACT_PRIMARY_ALT1_VM_INSPECT_START"
        );
        assert_eq!(found[0].sequences[0].animations, ["example_anim"]);
        assert!(found[1].sequences.is_empty());
        assert_eq!(found[3].visual, "blu");
        assert_eq!(found[3].target_activity, "ACT_PRIMARY_VM_INSPECT_START");
        assert_eq!(found[6].target_activity, "ACT_SECONDARY_VM_INSPECT_START");
        assert_eq!(
            found[6].sequences[0].label,
            "ACT_SECONDARY_VM_INSPECT_START"
        );
    }
}
