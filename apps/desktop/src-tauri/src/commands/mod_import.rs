//! Native-owned, single-use mod import reviews. No profile or live writes before confirmation.
use std::path::{Path, PathBuf};

use execs_core::mod_import::{ModImportChoice, ModImportReadme, PreparedModImport};
use execs_core::mods::{ModBatchBudget, ModSource, MAX_MOD_BYTES};
use execs_core::ProfileDetail;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::shared::{blocking, with_profile, ActiveContext};
use crate::error::CommandError;
use crate::{gamebanana, WriteGate};

#[derive(Default)]
pub struct PendingModImport(tokio::sync::Mutex<Option<(String, PendingImport)>>);

struct PendingImport {
    context: ActiveContext,
    revision: String,
    inputs: Vec<ImportInput>,
    source: ModSource,
}

struct ImportInput {
    local: Option<(PathBuf, bool)>,
    prepared: PreparedModImport,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModImportReview {
    token: String,
    choices: Vec<ModImportChoice>,
    readmes: Vec<ModImportReadme>,
}

fn revision(profile_id: &str) -> Result<String, CommandError> {
    let manifest = execs_core::profile::load_manifest(&execs_core::profiles_dir(), profile_id)?;
    let bytes = serde_json::to_vec(&manifest).map_err(|e| CommandError::unknown(e.to_string()))?;
    Ok(execs_core::hash::sha256_hex(&bytes))
}

fn read_local(path: &Path, folder: bool) -> Result<PreparedModImport, CommandError> {
    if folder {
        return Ok(PreparedModImport::from_folder(path)?);
    }
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    if name.to_ascii_lowercase().ends_with(".vpk") {
        return Ok(PreparedModImport::from_vpk_file(path)?);
    }
    Ok(PreparedModImport::from_archive_file(path)?)
}

fn response(token: String, pending: &PendingImport) -> Result<ModImportReview, CommandError> {
    let mut choices = Vec::new();
    let mut readmes = Vec::new();
    let mut total_bytes = 0u64;
    let mut total_files = 0usize;
    for (index, input) in pending.inputs.iter().enumerate() {
        for choice in &input.prepared.choices {
            total_bytes = total_bytes.saturating_add(choice.bytes);
            total_files = total_files.saturating_add(choice.files);
            if total_bytes > MAX_MOD_BYTES || total_files > 20_000 || choices.len() >= 256 {
                return Err(CommandError::unknown(
                    "The selected archives exceed the mod import limits. Choose fewer files.",
                ));
            }
            let mut choice = choice.clone();
            choice.id = format!("{index}:{}", choice.id);
            choices.push(choice);
        }
        readmes.extend(
            input
                .prepared
                .readmes
                .iter()
                .take(8usize.saturating_sub(readmes.len()))
                .cloned()
                .map(|mut readme| {
                    if pending.inputs.len() > 1 {
                        readme.path = format!("Selection {} / {}", index + 1, readme.path);
                    }
                    readme
                }),
        );
    }
    Ok(ModImportReview {
        token,
        choices,
        readmes,
    })
}

async fn prepare_local(
    pending: &PendingModImport,
    app: AppHandle,
    folder: bool,
) -> Result<Option<ModImportReview>, CommandError> {
    let mut slot = pending.0.lock().await;
    *slot = None;
    let (context, baseline) = with_profile(|root, id| {
        execs_core::refuse_if_running()?;
        Ok((ActiveContext::capture(&root, &id), revision(&id)?))
    })
    .await?;
    let paths = tauri::async_runtime::spawn_blocking(move || {
        if folder {
            app.dialog()
                .file()
                .set_title("Add a mod folder")
                .blocking_pick_folder()
                .map(|p| vec![p])
        } else {
            app.dialog()
                .file()
                .set_title("Add mods (.vpk, .zip, .7z or .rar)")
                .add_filter("Mods", &["vpk", "zip", "7z", "rar"])
                .blocking_pick_files()
        }
    })
    .await
    .map_err(|e| CommandError::unknown(e.to_string()))?;
    let Some(paths) = paths else { return Ok(None) };
    let paths = paths
        .into_iter()
        .map(|p| p.into_path())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| CommandError::unknown(e.to_string()))?;
    if paths.is_empty() {
        return Ok(None);
    }
    let prepared = blocking(move || {
        let mut pending = PendingImport {
            context,
            revision: baseline,
            inputs: Vec::new(),
            source: ModSource::Local,
        };
        for path in paths {
            let prepared = read_local(&path, folder)?;
            pending.inputs.push(ImportInput {
                local: Some((path, folder)),
                prepared,
            });
            // Bound the aggregate immediately, before reading another source.
            response(String::new(), &pending)?;
        }
        Ok(pending)
    })
    .await?;
    let token = execs_core::hash::random_token();
    let review = response(token.clone(), &prepared)?;
    *slot = Some((token, prepared));
    Ok(Some(review))
}

#[tauri::command]
pub async fn prepare_import_mod_archive(
    pending: tauri::State<'_, PendingModImport>,
    app: AppHandle,
) -> Result<Option<ModImportReview>, CommandError> {
    prepare_local(&pending, app, false).await
}

#[tauri::command]
pub async fn prepare_import_mod_folder(
    pending: tauri::State<'_, PendingModImport>,
    app: AppHandle,
) -> Result<Option<ModImportReview>, CommandError> {
    prepare_local(&pending, app, true).await
}

#[tauri::command]
pub async fn prepare_gamebanana_mod(
    pending: tauri::State<'_, PendingModImport>,
    id: u64,
    file_id: u64,
) -> Result<ModImportReview, CommandError> {
    let mut slot = pending.0.lock().await;
    *slot = None;
    let prepared = with_profile(move |root, profile_id| {
        execs_core::refuse_if_running()?;
        let baseline = revision(&profile_id)?;
        let profile = gamebanana::mod_profile(id)?;
        let pick = gamebanana::download_file(id, file_id)?;
        let bytes = gamebanana::download_pick(&pick)?;
        let prepared = if gamebanana::is_bare_vpk(&pick.file_name, &bytes) {
            PreparedModImport::from_vpk(&format!("{}.vpk", profile.name), bytes)?
        } else {
            PreparedModImport::from_archive(&profile.name, &bytes)?
        };
        Ok(PendingImport {
            context: ActiveContext::capture(&root, &profile_id),
            revision: baseline,
            inputs: vec![ImportInput {
                local: None,
                prepared,
            }],
            source: ModSource::Gamebanana {
                id: profile.id,
                url: profile.url,
            },
        })
    })
    .await?;
    let token = execs_core::hash::random_token();
    let review = response(token.clone(), &prepared)?;
    *slot = Some((token, prepared));
    Ok(review)
}

fn take_review<T>(slot: &mut Option<(String, T)>, token: &str) -> Result<T, CommandError> {
    if slot.as_ref().is_none_or(|(stored, _)| stored != token) {
        return Err(CommandError::new(
            "ImportReviewExpired",
            "Choose the mod again to review its files.",
        ));
    }
    Ok(slot.take().expect("checked review").1)
}

fn cancel_review<T>(slot: &mut Option<(String, T)>, token: &str) {
    if slot.as_ref().is_some_and(|(stored, _)| stored == token) {
        *slot = None;
    }
}

fn ensure_review_current(
    prepared: &PendingImport,
    root: &Path,
    id: &str,
    current_revision: &str,
) -> Result<(), CommandError> {
    prepared.context.ensure_current(root, id)?;
    if prepared.revision != current_revision {
        return Err(CommandError::new(
            "ImportReviewExpired",
            "The profile changed after review. Choose the mod again.",
        ));
    }
    Ok(())
}

fn selected_packs(
    pending: PendingImport,
    ids: &[String],
) -> Result<Vec<(String, execs_core::mods::ModContent)>, CommandError> {
    let allowed = response(String::new(), &pending)?.choices;
    let unique: std::collections::BTreeSet<_> = ids.iter().collect();
    if ids.is_empty()
        || unique.len() != ids.len()
        || ids.iter().any(|id| {
            !allowed
                .iter()
                .any(|choice| &choice.id == id && choice.disabled_reason.is_none())
        })
    {
        return Err(CommandError::unknown(
            "Select one or more available choices, each only once.",
        ));
    }
    let mut packs = Vec::new();
    let mut budget = ModBatchBudget::default();
    for (index, input) in pending.inputs.into_iter().enumerate() {
        // Re-read every local source, including unselected choices, before installing anything.
        if let Some((path, folder)) = &input.local {
            let current = read_local(path, *folder)?;
            if current.fingerprint != input.prepared.fingerprint {
                return Err(CommandError::new(
                    "ImportSourceChanged",
                    "The mod files changed after review. Choose them again.",
                ));
            }
        }
        let prefix = format!("{index}:");
        let selected: Vec<_> = ids
            .iter()
            .filter_map(|id| id.strip_prefix(&prefix).map(str::to_string))
            .collect();
        if selected.is_empty() {
            continue;
        }
        for pack in input.prepared.select(&selected)? {
            budget.add(&pack.1)?;
            packs.push(pack);
        }
    }
    Ok(packs)
}

#[tauri::command]
pub async fn confirm_mod_import(
    gate: tauri::State<'_, WriteGate>,
    pending: tauri::State<'_, PendingModImport>,
    token: String,
    choices: Vec<String>,
) -> Result<ProfileDetail, CommandError> {
    let prepared = take_review(&mut *pending.0.lock().await, &token)?;
    let _guard = gate.lock_for_write().await?;
    let result = with_profile(move |root, id| {
        execs_core::refuse_if_running()?;
        ensure_review_current(&prepared, &root, &id, &revision(&id)?)?;
        let source = prepared.source.clone();
        let packs = selected_packs(prepared, &choices)?;
        Ok(execs_core::mods::install_mods(&root, &id, packs, source)?)
    })
    .await;
    super::shared::logged("Installed mod packs", result)
}

#[tauri::command]
pub async fn cancel_mod_import(
    pending: tauri::State<'_, PendingModImport>,
    token: String,
) -> Result<(), CommandError> {
    cancel_review(&mut *pending.0.lock().await, &token);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::fs;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "execs-mod-review-{}",
                execs_core::hash::random_token()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
    fn vpk(value: u8) -> Vec<u8> {
        execs_core::vpk::write_vpk_v2(&BTreeMap::from([(
            "materials/a.vmt".into(),
            vec![value; 4],
        )]))
    }
    fn pending(path: &Path, folder: bool) -> PendingImport {
        PendingImport {
            context: ActiveContext::capture(Path::new("fixture-root"), "profile-a"),
            revision: "revision-a".into(),
            inputs: vec![ImportInput {
                local: Some((path.into(), folder)),
                prepared: read_local(path, folder).unwrap(),
            }],
            source: ModSource::Local,
        }
    }
    #[test]
    fn approval_and_cancel_are_single_use_and_never_touch_source_bytes() {
        let fixture = Fixture::new();
        let path = fixture.0.join("pack.vpk");
        let original = vpk(1);
        fs::write(&path, &original).unwrap();
        let mut slot = Some(("review-a".into(), pending(&path, false)));
        assert!(take_review(&mut slot, "forged").is_err());
        cancel_review(&mut slot, "old-review");
        assert!(slot.is_some());
        cancel_review(&mut slot, "review-a");
        assert!(take_review(&mut slot, "review-a").is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
        let mut slot = Some(("review-b".into(), pending(&path, false)));
        let prepared = take_review(&mut slot, "review-b").unwrap();
        assert!(take_review(&mut slot, "review-b").is_err());
        let packs = selected_packs(prepared, &["0:0".into()]).unwrap();
        assert_eq!(packs[0].1, execs_core::mods::ModContent::Vpk(original));
    }

    #[test]
    fn equal_length_source_replacement_refuses_exact_byte_review() {
        let fixture = Fixture::new();
        let path = fixture.0.join("pack.vpk");
        fs::write(&path, vpk(1)).unwrap();
        let prepared = pending(&path, false);
        assert_eq!(vpk(1).len(), vpk(2).len());
        fs::write(&path, vpk(2)).unwrap();
        let error = selected_packs(prepared, &["0:0".into()]).unwrap_err();
        assert_eq!(error.code, "ImportSourceChanged");
    }

    #[test]
    fn folder_membership_and_unselected_source_changes_invalidate_the_whole_review() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.0.join("red/materials")).unwrap();
        fs::create_dir_all(fixture.0.join("blue/materials")).unwrap();
        fs::write(fixture.0.join("red/materials/a.vmt"), "red").unwrap();
        fs::write(fixture.0.join("blue/materials/a.vmt"), "blue").unwrap();
        let prepared = pending(&fixture.0, true);
        // Select blue, but change the unselected red option.
        fs::write(fixture.0.join("red/materials/extra.vmt"), "new").unwrap();
        assert_eq!(
            selected_packs(prepared, &["0:0".into()]).unwrap_err().code,
            "ImportSourceChanged"
        );
        let prepared = pending(&fixture.0, true);
        fs::remove_file(fixture.0.join("red/materials/extra.vmt")).unwrap();
        assert_eq!(
            selected_packs(prepared, &["0:0".into()]).unwrap_err().code,
            "ImportSourceChanged"
        );
    }

    #[test]
    fn root_profile_revision_and_forged_selection_are_rechecked() {
        let fixture = Fixture::new();
        let path = fixture.0.join("pack.vpk");
        fs::write(&path, vpk(1)).unwrap();
        let prepared = pending(&path, false);
        assert!(ensure_review_current(
            &prepared,
            Path::new("fixture-root"),
            "profile-a",
            "revision-a"
        )
        .is_ok());
        assert_eq!(
            ensure_review_current(
                &prepared,
                Path::new("other-root"),
                "profile-a",
                "revision-a"
            )
            .unwrap_err()
            .code,
            "RootChanged"
        );
        assert_eq!(
            ensure_review_current(
                &prepared,
                Path::new("fixture-root"),
                "profile-b",
                "revision-a"
            )
            .unwrap_err()
            .code,
            "ProfileChanged"
        );
        assert_eq!(
            ensure_review_current(
                &prepared,
                Path::new("fixture-root"),
                "profile-a",
                "revision-b"
            )
            .unwrap_err()
            .code,
            "ImportReviewExpired"
        );
        for ids in [
            vec![],
            vec!["0:0".into(), "0:0".into()],
            vec!["1:0".into()],
            vec!["0:99".into()],
        ] {
            assert!(selected_packs(pending(&path, false), &ids).is_err());
        }
    }

    #[test]
    fn aggregate_review_limits_apply_across_separate_sources() {
        let fixture = Fixture::new();
        let path = fixture.0.join("pack.vpk");
        fs::write(&path, vpk(1)).unwrap();
        let mut prepared = pending(&path, false);
        prepared.inputs[0].prepared.choices[0].bytes = MAX_MOD_BYTES;
        prepared.inputs.push(ImportInput {
            local: None,
            prepared: PreparedModImport::from_vpk("second.vpk", vpk(2)).unwrap(),
        });
        assert!(response("review".into(), &prepared).is_err());
    }
}
