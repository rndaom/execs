//! Pure hand-activity translation for a resolved TF2 weapon role.
//!
//! This reproduces the functional cases in Valve's `TranslateViewmodelHandActivityInternal`
//! (Source SDK 2013 b8cfb12) using role/action families. It is not an item
//! reachability result: per-team item replacements run before this translation,
//! and inspect plus specialized weapon paths must be considered separately.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HandActivityTranslation {
    pub target: String,
    /// An identity result can still be a deliberate engine table entry.
    pub matched_role_rule: bool,
}

const BASIC_ACTIONS: [&str; 11] = [
    "ACT_VM_DRAW",
    "ACT_VM_HOLSTER",
    "ACT_VM_IDLE",
    "ACT_VM_PULLBACK",
    "ACT_VM_PRIMARYATTACK",
    "ACT_VM_SECONDARYATTACK",
    "ACT_VM_RELOAD",
    "ACT_VM_DRYFIRE",
    "ACT_VM_IDLE_TO_LOWERED",
    "ACT_VM_IDLE_LOWERED",
    "ACT_VM_LOWERED_TO_IDLE",
];

const MULTIPLAYER_ATTACKS: [&str; 7] = [
    "ACT_MP_ATTACK_STAND_PREFIRE",
    "ACT_MP_ATTACK_STAND_POSTFIRE",
    "ACT_MP_ATTACK_STAND_STARTFIRE",
    "ACT_MP_ATTACK_CROUCH_PREFIRE",
    "ACT_MP_ATTACK_CROUCH_POSTFIRE",
    "ACT_MP_ATTACK_SWIM_PREFIRE",
    "ACT_MP_ATTACK_SWIM_POSTFIRE",
];

const MELEE_UNCHANGED: [&str; 14] = [
    "ACT_VM_DRAW_SPECIAL",
    "ACT_VM_HOLSTER_SPECIAL",
    "ACT_VM_IDLE_SPECIAL",
    "ACT_VM_PULLBACK_SPECIAL",
    "ACT_VM_PRIMARYATTACK_SPECIAL",
    "ACT_VM_SECONDARYATTACK_SPECIAL",
    "ACT_VM_HITCENTER_SPECIAL",
    "ACT_VM_SWINGHARD_SPECIAL",
    "ACT_VM_IDLE_TO_LOWERED_SPECIAL",
    "ACT_VM_IDLE_LOWERED_SPECIAL",
    "ACT_VM_LOWERED_TO_IDLE_SPECIAL",
    "ACT_BACKSTAB_VM_DOWN",
    "ACT_BACKSTAB_VM_UP",
    "ACT_BACKSTAB_VM_IDLE",
];

/// Translate a base hand activity after an independently resolved role.
/// Unknown role/action pairs preserve the engine's identity fallback.
pub fn translate_hand_activity(role: &str, base: &str) -> HandActivityTranslation {
    let recognized = matches!(
        role,
        "PRIMARY"
            | "SECONDARY"
            | "MELEE"
            | "PDA"
            | "ITEM1"
            | "ITEM2"
            | "ITEM3"
            | "ITEM4"
            | "MELEE_ALLCLASS"
            | "SECONDARY2"
            | "PRIMARY2"
    );
    let compact = matches!(role, "PRIMARY2" | "SECONDARY2");
    let basic = BASIC_ACTIONS.contains(&base) && !(compact && base == "ACT_VM_SECONDARYATTACK");
    let hit_or_swing = matches!(base, "ACT_VM_HITCENTER" | "ACT_VM_SWINGHARD")
        && matches!(role, "MELEE" | "MELEE_ALLCLASS");
    let reload_transition = matches!(base, "ACT_RELOAD_START" | "ACT_RELOAD_FINISH")
        && matches!(
            role,
            "PRIMARY" | "SECONDARY" | "ITEM1" | "PRIMARY2" | "SECONDARY2"
        );
    let multiplayer = MULTIPLAYER_ATTACKS.contains(&base)
        && matches!(
            role,
            "PRIMARY" | "SECONDARY" | "MELEE" | "ITEM1" | "ITEM2" | "ITEM3" | "ITEM4"
        );
    if role == "MELEE" && MELEE_UNCHANGED.contains(&base) {
        return HandActivityTranslation {
            target: base.to_string(),
            matched_role_rule: true,
        };
    }
    if !recognized || !(basic || hit_or_swing || reload_transition || multiplayer) {
        return HandActivityTranslation {
            target: base.to_string(),
            matched_role_rule: false,
        };
    }
    let prefix = if role == "PRIMARY2" { "PRIMARY" } else { role };
    let suffix = if multiplayer {
        base.strip_prefix("ACT_MP_")
            .expect("known multiplayer action")
    } else {
        base.strip_prefix("ACT_").expect("known action")
    };
    let mut target = format!("ACT_{prefix}_{suffix}");
    if role == "PRIMARY2"
        && matches!(
            base,
            "ACT_VM_RELOAD" | "ACT_RELOAD_START" | "ACT_RELOAD_FINISH"
        )
    {
        target.push_str("_3");
    }
    HandActivityTranslation {
        target,
        matched_role_rule: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_the_nonuniform_and_identity_paths() {
        let check = |role: &str, base: &str, expected: &str, matched: bool| {
            let actual = translate_hand_activity(role, base);
            assert_eq!(actual.target, expected, "{role} / {base}");
            assert_eq!(actual.matched_role_rule, matched, "{role} / {base}");
        };
        check("SECONDARY", "ACT_VM_DRAW", "ACT_SECONDARY_VM_DRAW", true);
        check("ITEM1", "ACT_RELOAD_START", "ACT_ITEM1_RELOAD_START", true);
        check("ITEM2", "ACT_RELOAD_START", "ACT_RELOAD_START", false);
        check("MELEE", "ACT_VM_HITCENTER", "ACT_MELEE_VM_HITCENTER", true);
        check(
            "MELEE",
            "ACT_BACKSTAB_VM_DOWN",
            "ACT_BACKSTAB_VM_DOWN",
            true,
        );
        check(
            "PRIMARY",
            "ACT_MP_ATTACK_STAND_PREFIRE",
            "ACT_PRIMARY_ATTACK_STAND_PREFIRE",
            true,
        );
        check("PRIMARY2", "ACT_VM_DRAW", "ACT_PRIMARY_VM_DRAW", true);
        check("PRIMARY2", "ACT_VM_RELOAD", "ACT_PRIMARY_VM_RELOAD_3", true);
        check(
            "PRIMARY2",
            "ACT_RELOAD_FINISH",
            "ACT_PRIMARY_RELOAD_FINISH_3",
            true,
        );
        check(
            "SECONDARY2",
            "ACT_VM_SECONDARYATTACK",
            "ACT_VM_SECONDARYATTACK",
            false,
        );
        check("BUILDING", "ACT_VM_DRAW", "ACT_VM_DRAW", false);
        check(
            "PRIMARY",
            "ACT_VM_INSPECT_START",
            "ACT_VM_INSPECT_START",
            false,
        );
    }
}
