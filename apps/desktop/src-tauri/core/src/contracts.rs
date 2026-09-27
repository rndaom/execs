//! Serialized contract fixtures for the records the UI reads.
//!
//! Each test serializes a fully populated record (every optional field set) and
//! compares it with the checked-in JSON under `apps/desktop/src/lib/contracts/`.
//! The frontend test checks those same files against the TypeScript bridge
//! types, so a renamed, added or retyped field fails on one side or the other.
//! Regenerate after an intended change with `EXECS_UPDATE_CONTRACTS=1`.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::apply::ProfileDetail;
use crate::hitsound::{HitsoundEntry, HitsoundRecord, HitsoundSource};
use crate::mods::{ModRecord, ModSource};
use crate::profile::{
    CrosshairRecord, CrosshairStockSettings, FileStorage, HudRecord, HudSource, ProfileFile,
    ProfileLibrary, ProfileSummary, ViewmodelBuildCatalog, ViewmodelBuildChoice,
    ViewmodelBuildRecipe, ViewmodelHideMode, ViewmodelRecord, ViewmodelSource,
    ViewmodelSourceFingerprint,
};
use crate::surface::CfgLayer;

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../src/lib/contracts")
        .join(format!("{name}.gen.json"))
}

/// Compare with the fixture, or rewrite it when regeneration is requested.
fn check_contract<T: Serialize + DeserializeOwned + PartialEq + std::fmt::Debug>(
    name: &str,
    value: &T,
) {
    let json = format!("{}\n", serde_json::to_string_pretty(value).unwrap());
    let path = fixture_path(name);
    if std::env::var_os("EXECS_UPDATE_CONTRACTS").is_some() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &json).unwrap();
    }
    let stored = std::fs::read_to_string(&path)
        .unwrap_or_else(|_| {
            panic!(
                "missing contract {}; run with EXECS_UPDATE_CONTRACTS=1",
                path.display()
            )
        })
        .replace("\r\n", "\n");
    assert_eq!(
        stored, json,
        "{name} serialization changed; update the TypeScript bridge type, then run with EXECS_UPDATE_CONTRACTS=1"
    );
    // The fixture is also a valid payload for the native reader.
    assert_eq!(&serde_json::from_str::<T>(&stored).unwrap(), value);
}

const SHA: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

fn hitsound_record() -> HitsoundRecord {
    HitsoundRecord {
        source_changed: true,
        hit: Some(HitsoundEntry {
            name: "ding.wav".into(),
            source: HitsoundSource::File,
            boost: 6,
            token: Some("0123456789abcdef0123456789abcdef".into()),
            hash: None,
        }),
        kill: Some(HitsoundEntry {
            name: "Classic".into(),
            source: HitsoundSource::Comfig,
            boost: 12,
            token: None,
            hash: Some(SHA.into()),
        }),
    }
}

fn profile_detail() -> ProfileDetail {
    ProfileDetail {
        id: "3f2b8c1e-0000-4000-8000-000000000001".into(),
        name: "Main".into(),
        launch_options: "-novid +exec execs_preload".into(),
        layer: CfgLayer::Comfig,
        files: vec![
            ProfileFile {
                path: "tf/cfg/config.cfg".into(),
                sha256: SHA.into(),
                storage: FileStorage::Exclusive,
            },
            ProfileFile {
                path: "tf/custom/mastercomfig-base.vpk".into(),
                sha256: SHA.into(),
                storage: FileStorage::Shared,
            },
        ],
        hud_roots: vec!["flawhud".into(), "toonhud".into()],
        selected_hud_root: Some("flawhud".into()),
        hud: Some(HudRecord {
            id: "flawhud".into(),
            hash: Some(SHA.into()),
            source: HudSource::HudDb,
            options: BTreeMap::from([("crosshair".into(), "true".into())]),
        }),
        crosshair: Some(CrosshairRecord {
            id: "execs-crosshairs".into(),
            source_changed: true,
            source_scripts_sha256: Some(SHA.into()),
            inactive: true,
            scale: Some(32),
            stock: Some(CrosshairStockSettings {
                file: "crosshair5".into(),
                scale: 32,
            }),
            shape: "dot".into(),
            assignments: BTreeMap::from([("tf_weapon_rocketlauncher".into(), "designed".into())]),
            color: Some([255, 128, 0]),
            library: BTreeMap::from([("mine".into(), "rgba".into())]),
            design: Some("{\"gap\":2}".into()),
        }),
        viewmodel: Some(ViewmodelRecord {
            id: "execs-viewmodels".into(),
            source_changed: true,
            source: ViewmodelSource::StockBuilt,
            preload: true,
            options: BTreeMap::from([("scout".into(), "hidden".into())]),
            build_recipe: Some(ViewmodelBuildRecipe {
                schema: 1,
                catalog: ViewmodelBuildCatalog {
                    patch_version: "10412354".into(),
                    catalog_sha256: SHA.into(),
                },
                choices: vec![ViewmodelBuildChoice {
                    group_id: "scout-primary".into(),
                    mode: ViewmodelHideMode::Weapon,
                }],
                source_fingerprints: vec![ViewmodelSourceFingerprint {
                    id: "models/weapons/c_models/c_scout_animations.mdl".into(),
                    sha256: SHA.into(),
                }],
            }),
        }),
        hitsound: Some(hitsound_record()),
        mods: vec![
            ModRecord {
                id: "skins".into(),
                name: "Skins".into(),
                source: ModSource::Gamebanana {
                    id: 123456,
                    url: "https://gamebanana.com/mods/123456".into(),
                },
                pack: "skins.vpk".into(),
                files: 1,
                bytes: 2048,
                installed_at: "2026-09-26T12:00:00Z".into(),
            },
            ModRecord {
                id: "local-pack".into(),
                name: "Local pack".into(),
                source: ModSource::Local,
                pack: "local-pack".into(),
                files: 3,
                bytes: 4096,
                installed_at: "2026-09-26T12:00:00Z".into(),
            },
            ModRecord {
                id: "found".into(),
                name: "found".into(),
                source: ModSource::External,
                pack: "found".into(),
                files: 2,
                bytes: 10,
                installed_at: "2026-09-26T12:00:00Z".into(),
            },
        ],
    }
}

fn profile_library() -> ProfileLibrary {
    ProfileLibrary {
        initialized: true,
        usable: true,
        root_mismatch: false,
        tf2_root: Some("C:/Steam/steamapps/common/Team Fortress 2".into()),
        confirmed_root: Some("C:/Steam/steamapps/common/Team Fortress 2".into()),
        active_profile_id: None,
        interrupted_profile_id: Some("3f2b8c1e-0000-4000-8000-000000000001".into()),
        pending_switch_profile_id: Some("3f2b8c1e-0000-4000-8000-000000000002".into()),
        profiles: vec![ProfileSummary {
            id: "3f2b8c1e-0000-4000-8000-000000000001".into(),
            name: "Main".into(),
            created_at: "2026-09-26T12:00:00Z".into(),
            updated_at: "2026-09-26T12:30:00Z".into(),
            unsafe_custom_folders: vec!["materials".into()],
        }],
    }
}

#[test]
fn profile_detail_contract() {
    check_contract("profile-detail", &profile_detail());
}

#[test]
fn profile_library_contract() {
    check_contract("profile-library", &profile_library());
}

#[test]
fn legacy_records_without_optional_fields_still_deserialize() {
    let detail: ProfileDetail = serde_json::from_str(
        r#"{"id":"a","name":"Old","launchOptions":"","layer":"vanilla","files":[]}"#,
    )
    .unwrap();
    assert!(detail.hud.is_none() && detail.mods.is_empty() && detail.hud_roots.is_empty());
    let entry: HitsoundEntry =
        serde_json::from_str(r#"{"name":"a.wav","source":"community"}"#).unwrap();
    assert_eq!((entry.boost, entry.token, entry.hash), (0, None, None));
    let crosshair: CrosshairRecord = serde_json::from_str(r#"{"id":"execs-crosshairs"}"#).unwrap();
    assert!(!crosshair.inactive && crosshair.scale.is_none());
    let library: ProfileLibrary = serde_json::from_str(
        r#"{"initialized":true,"usable":true,"rootMismatch":false,"tf2Root":null,"confirmedRoot":null,"activeProfileId":null,"profiles":[{"id":"a","name":"Old","createdAt":"","updatedAt":""}]}"#,
    )
    .unwrap();
    assert!(library.pending_switch_profile_id.is_none());
}
