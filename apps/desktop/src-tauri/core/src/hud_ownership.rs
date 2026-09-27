//! Exact-byte HUD ownership review shared by legacy profiles and live changes.

use super::*;
use crate::hash::{sha256_hex, write_atomic_within};
use std::io::{Read, Seek, SeekFrom};

const MAX_INFO_BYTES: u64 = 1024 * 1024;

pub(crate) fn refuse_hud_vpk(path: &Path, expected_hash: Option<&str>) -> Result<(), ProfileError> {
    let mut file = fs::File::open(path).map_err(|err| ProfileError::Io(err.to_string()))?;
    let mut signature = Vec::with_capacity(4);
    file.by_ref()
        .take(4)
        .read_to_end(&mut signature)
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    // Historical opaque .vpk files retain their existing behavior.
    if signature.as_slice() != 0x55aa_1234u32.to_le_bytes() {
        return Ok(());
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|err| ProfileError::Io(err.to_string()))?;
    let (archive, hash) = crate::vpk::read_vpk_file_filtered_hashed(
        &mut file,
        &|member| member.eq_ignore_ascii_case("info.vdf"),
        MAX_INFO_BYTES,
    )
    .map_err(|err| ProfileError::Io(err.message()))?;
    if expected_hash.is_some_and(|expected| !expected.eq_ignore_ascii_case(&hash)) {
        return Err(ProfileError::Io(
            "A profile VPK changed while checking its HUD metadata.".into(),
        ));
    }
    if archive
        .files
        .values()
        .any(|bytes| is_current_hud_info(bytes))
    {
        return Err(ProfileError::HudImportRequired("This setup contains a HUD packaged as a VPK. Its original files have not been changed. Extract that HUD and import its folder through HUD → Import HUD; remove the HUD VPK from the source setup or archive before retrying. Other mod VPKs can stay as they are.".into()));
    }
    Ok(())
}

pub(crate) fn refuse_profile_hud_vpks(
    profiles: &Path,
    manifest: &ProfileManifest,
) -> Result<(), ProfileError> {
    for file in &manifest.files {
        let Some(rest) = file.path.strip_prefix("tf/custom/") else {
            continue;
        };
        if rest.contains('/') || !rest.to_ascii_lowercase().ends_with(".vpk") {
            continue;
        }
        let source = match file.storage {
            crate::profile::FileStorage::Exclusive => {
                exclusive_file_path(profiles, &manifest.id, &file.path)
            }
            crate::profile::FileStorage::Shared => crate::blob::blob_path(profiles, &file.sha256),
        };
        crate::hash::validate_file_within(profiles, &source)
            .map_err(|err| ProfileError::Io(err.to_string()))?;
        refuse_hud_vpk(&source, Some(&file.sha256))?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HudOwnershipCandidate {
    pub folder: String,
    pub source: String,
    pub files: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HudOwnershipReview {
    pub profile_id: String,
    pub selected_hud: Option<String>,
    pub candidates: Vec<HudOwnershipCandidate>,
    pub fingerprint: String,
    pub review_required: bool,
    pub managed_option_files: Vec<String>,
    pub reset_options: bool,
}

pub(crate) fn inspect_profile_hud_roots(
    profiles: &Path,
    manifest: &ProfileManifest,
) -> Result<Vec<String>, ProfileError> {
    inspect_hud_roots_from_files_root(
        profiles,
        &profiles.join(&manifest.id).join("files"),
        manifest,
    )
}

pub(crate) fn inspect_hud_roots_from_files_root(
    containment_root: &Path,
    files_root: &Path,
    manifest: &ProfileManifest,
) -> Result<Vec<String>, ProfileError> {
    inspect_hud_roots_with_sources(containment_root, manifest, |file| {
        files_root.join(&file.path)
    })
}

pub(crate) fn inspect_hud_roots_with_sources(
    containment_root: &Path,
    manifest: &ProfileManifest,
    source: impl Fn(&ProfileFile) -> PathBuf,
) -> Result<Vec<String>, ProfileError> {
    let mut roots = Vec::new();
    for file in &manifest.files {
        let Some(rest) = file.path.strip_prefix("tf/custom/") else {
            continue;
        };
        let Some((folder, rel)) = rest.split_once('/') else {
            continue;
        };
        if !rel.eq_ignore_ascii_case("info.vdf") || is_stock_custom_pack(folder) {
            continue;
        }
        let bytes =
            read_regular_file_bounded_within(containment_root, &source(file), MAX_INFO_BYTES)?
                .ok_or_else(|| {
                    ProfileError::Io(format!("{} is too large to inspect safely.", file.path))
                })?;
        if !sha256_hex(&bytes).eq_ignore_ascii_case(&file.sha256) {
            return Err(ProfileError::Io(format!(
                "The saved HUD source changed: {}. Restore its original bytes before continuing.",
                file.path
            )));
        }
        if is_current_hud_info(&bytes)
            && !roots
                .iter()
                .any(|root: &String| root.eq_ignore_ascii_case(folder))
        {
            roots.push(folder.to_string());
        }
    }
    roots.sort_by_key(|root| root.to_ascii_lowercase());
    Ok(roots)
}

pub(crate) fn require_resolved_hud(manifest: &ProfileManifest) -> Result<(), ProfileError> {
    if manifest.hud_review_pending
        || (manifest_hud_packs(manifest).len() > 1 && selected_hud_pack(manifest).is_none())
    {
        return Err(ProfileError::HudReviewRequired);
    }
    Ok(())
}

/// HUD replacement owns only the cfg bytes already saved on the profile.
/// Unabsorbed handwriting must never be overwritten by a new autoexec.
pub(super) fn require_unchanged_live_cfgs(
    profiles: &Path,
    root: &Path,
    manifest: &ProfileManifest,
    paths: &[String],
) -> Result<(), ProfileError> {
    if load_library_from(profiles, Some(root))?
        .active_profile_id
        .as_deref()
        != Some(&manifest.id)
    {
        return Ok(());
    }
    for path in paths {
        let lower = path.to_ascii_lowercase();
        if !is_managed_hud_cfg(path)
            && !matches!(
                lower.as_str(),
                "tf/cfg/autoexec.cfg" | "tf/cfg/overrides/autoexec.cfg"
            )
        {
            continue;
        }
        let expected = manifest
            .files
            .iter()
            .find(|file| file.path.eq_ignore_ascii_case(path))
            .map(|file| file.sha256.as_str());
        let live = root.join(path);
        let actual = match fs::symlink_metadata(&live) {
            Ok(_) => {
                let bytes = read_regular_file_bounded_within(
                    root,
                    &live,
                    crate::hash::MAX_CFG_FILE_BYTES as u64,
                )?
                .ok_or_else(|| {
                    ProfileError::Io(format!("{path} exceeds the cfg inspection limit."))
                })?;
                Some(sha256_hex(&bytes))
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
            Err(err) => return Err(ProfileError::Io(err.to_string())),
        };
        if actual.as_deref() != expected {
            return Err(ProfileError::Io(format!("{path} changed outside this profile. Update the profile from disk before replacing its HUD; the live cfg has not been overwritten.")));
        }
    }
    Ok(())
}

/// A second external HUD is a decision, never an ordinary pack addition.
pub(crate) fn require_resolved_live_huds(
    profiles: &Path,
    root: &Path,
    profile_id: &str,
) -> Result<(), ProfileError> {
    let manifest = load_manifest(profiles, profile_id)?;
    require_resolved_hud(&manifest).map_err(|_| ProfileError::HudLiveReviewRequired)?;
    let live = live_hud_names_checked(root)?;
    let selected = selected_hud_pack(&manifest);
    if live.len() > 1
        || (live.len() == 1
            && selected
                .as_ref()
                .is_some_and(|selected| !selected.eq_ignore_ascii_case(&live[0].key)))
    {
        return Err(ProfileError::HudLiveReviewRequired);
    }
    Ok(())
}

struct Candidate {
    folder: String,
    source: &'static str,
    tree: HudTree,
}

fn ownership_sources(
    profiles: &Path,
    root: &Path,
    profile_id: &str,
) -> Result<(ProfileManifest, Vec<Candidate>), ProfileError> {
    let library = load_library_from(profiles, Some(root))?;
    if library.root_mismatch {
        return Err(ProfileError::FilesRootChanged);
    }
    let manifest = load_manifest(profiles, profile_id)?;
    let mut candidates = Vec::new();
    let mut total = 0u64;
    for folder in manifest_hud_packs(&manifest) {
        let tree = load_hud_tree_from_manifest_with_limit(
            profiles,
            profile_id,
            &manifest,
            &folder,
            MAX_HUD_TOTAL_BYTES.saturating_sub(total),
        )?;
        for file in &manifest.files {
            if let Some(rel) = hud_file_rel(&file.path, &folder) {
                let bytes = tree.get(rel).ok_or(ProfileError::InvalidPath)?;
                if !sha256_hex(bytes).eq_ignore_ascii_case(&file.sha256) {
                    return Err(ProfileError::Io(format!("The saved HUD source changed: {}. Review it again after restoring the original file.", file.path)));
                }
            }
        }
        validate_hud_info(&tree)?;
        total += tree
            .files
            .values()
            .map(|bytes| bytes.len() as u64)
            .sum::<u64>();
        candidates.push(Candidate {
            folder,
            source: "profile",
            tree,
        });
    }
    if library.active_profile_id.as_deref() == Some(profile_id) {
        let live = live_hud_names_checked(root)?;
        let mut identities = std::collections::BTreeSet::new();
        if live
            .iter()
            .any(|hud| !identities.insert(hud.name.to_ascii_lowercase()))
        {
            return Err(ProfileError::Io("Live HUD folders differ only by case. Rename one original folder before reviewing ownership; no HUD files were changed.".into()));
        }
        for hud in live {
            if let Some(index) = candidates
                .iter()
                .position(|candidate| candidate.folder.eq_ignore_ascii_case(&hud.name))
            {
                let previous = candidates.remove(index);
                total -= previous
                    .tree
                    .files
                    .values()
                    .map(|bytes| bytes.len() as u64)
                    .sum::<u64>();
            }
            let remaining = MAX_HUD_TOTAL_BYTES.saturating_sub(total);
            let extracted = finish_extracted(read_dir_entries(
                &root.join("tf/custom").join(&hud.name),
                ArchiveLimits::new(
                    MAX_HUD_ENTRIES,
                    MAX_HUD_ENTRY_BYTES.min(remaining),
                    remaining,
                ),
            )?)?;
            total += extracted
                .tree
                .files
                .values()
                .map(|bytes| bytes.len() as u64)
                .sum::<u64>();
            candidates.push(Candidate {
                folder: hud.name,
                source: "live",
                tree: extracted.tree,
            });
        }
    }
    candidates.sort_by_key(|candidate| candidate.folder.to_ascii_lowercase());
    Ok((manifest, candidates))
}

fn review_from_sources(
    manifest: &ProfileManifest,
    candidates: &[Candidate],
) -> Result<HudOwnershipReview, ProfileError> {
    let selected_hud = selected_hud_pack(manifest);
    let mut evidence =
        serde_json::to_vec(manifest).map_err(|err| ProfileError::Io(err.to_string()))?;
    for candidate in candidates {
        evidence.extend_from_slice(candidate.folder.as_bytes());
        evidence.push(0);
        evidence.extend_from_slice(candidate.source.as_bytes());
        evidence.push(0);
        for (path, bytes) in &candidate.tree.files {
            evidence.extend_from_slice(path.as_bytes());
            evidence.push(0);
            evidence.extend_from_slice(sha256_hex(bytes).as_bytes());
        }
    }
    Ok(HudOwnershipReview {
        profile_id: manifest.id.clone(),
        selected_hud,
        candidates: candidates
            .iter()
            .map(|candidate| HudOwnershipCandidate {
                folder: candidate.folder.clone(),
                source: candidate.source.into(),
                files: candidate.tree.files.len(),
            })
            .collect(),
        fingerprint: sha256_hex(&evidence),
        review_required: manifest.hud_review_pending
            || (manifest_hud_packs(manifest).len() > 1 && selected_hud_pack(manifest).is_none())
            || candidates
                .iter()
                .filter(|candidate| candidate.source == "live")
                .count()
                > 1
            || candidates.iter().any(|candidate| {
                candidate.source == "live"
                    && selected_hud_pack(manifest)
                        .is_some_and(|selected| !selected.eq_ignore_ascii_case(&candidate.folder))
            }),
        managed_option_files: manifest
            .files
            .iter()
            .filter(|file| is_managed_hud_cfg(&file.path))
            .map(|file| file.path.clone())
            .collect(),
        reset_options: manifest.hud_review_pending,
    })
}

pub fn get_hud_ownership_to(
    profiles: &Path,
    root: &Path,
    profile_id: &str,
) -> Result<HudOwnershipReview, ProfileError> {
    let (manifest, candidates) = ownership_sources(profiles, root, profile_id)?;
    review_from_sources(&manifest, &candidates)
}

pub fn select_profile_hud_to<I, S>(
    profiles: &Path,
    root: &Path,
    profile_id: &str,
    hud_folder: &str,
    expected_fingerprint: &str,
    running_names: I,
) -> Result<ProfileDetail, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let running: Vec<String> = running_names
        .into_iter()
        .map(|name| name.as_ref().to_string())
        .collect();
    refuse_if_running_among(&running)?;
    let (manifest, candidates) = ownership_sources(profiles, root, profile_id)?;
    if review_from_sources(&manifest, &candidates)?.fingerprint != expected_fingerprint {
        return Err(ProfileError::Io(
            "The HUD files changed after review. Review them again before choosing a HUD.".into(),
        ));
    }
    let candidate = candidates
        .iter()
        .find(|candidate| candidate.folder == hud_folder)
        .ok_or_else(|| ProfileError::Io("Choose one of the HUD folders in this review.".into()))?;
    let id = hud_id_from_name(&candidate.folder);
    let keep_current = !manifest.hud_review_pending
        && selected_hud_pack(&manifest)
            .is_some_and(|selected| selected.eq_ignore_ascii_case(hud_folder));
    let record = manifest
        .hud
        .clone()
        .filter(|_| keep_current)
        .unwrap_or(HudRecord {
            id: id.clone(),
            hash: None,
            source: HudSource::Local,
            options: BTreeMap::new(),
        });
    let record = HudRecord { id, ..record };
    let mut cfgs = Vec::new();
    if keep_current {
        for file in &manifest.files {
            if is_managed_hud_cfg(&file.path) {
                let source = exclusive_file_path(profiles, profile_id, &file.path);
                let bytes =
                    read_regular_file_bounded_within(profiles, &source, MAX_HUD_ENTRY_BYTES)?
                        .ok_or_else(|| {
                            ProfileError::Io("A saved HUD option file is too large.".into())
                        })?;
                if !sha256_hex(&bytes).eq_ignore_ascii_case(&file.sha256) {
                    return Err(ProfileError::Io(
                        "A saved HUD option file changed. Review it again.".into(),
                    ));
                }
                cfgs.push((file.path.clone(), bytes));
            }
        }
    }
    let recheck = || {
        let current = get_hud_ownership_to(profiles, root, profile_id)?;
        if current.fingerprint != expected_fingerprint {
            return Err(ProfileError::Io(
                "The HUD files changed after review. Review them again before choosing a HUD."
                    .into(),
            ));
        }
        Ok(())
    };
    install_hud_pack_with_cfgs_checked_to(
        profiles,
        root,
        profile_id,
        &candidate.tree,
        record,
        &cfgs,
        &running,
        Some(&recheck),
    )
}

/// A library copy may be inactive, so the live rename alone is insufficient.
/// Complete this additive snapshot before the journal removes any old files.
/// A failed publication may leave an extra recovery copy; it cannot lose one.
pub(super) fn preserve_library_hud_originals(
    profiles: &Path,
    manifest: &ProfileManifest,
    roots: &[String],
) -> Result<(), ProfileError> {
    if roots.is_empty() {
        return Ok(());
    }
    let selected_particles =
        crate::preloader::selected_profile_particle_mod_ids(profiles, &manifest.id)?;
    for record in &manifest.mods {
        if roots
            .iter()
            .any(|root| root.eq_ignore_ascii_case(&record.pack))
            && selected_particles.contains(&record.id)
        {
            return Err(ProfileError::ParticleSourceSelected(record.name.clone()));
        }
    }
    let backup = profiles
        .join(&manifest.id)
        .join("hud-backups")
        .join(random_token());
    let files: Vec<_> = manifest
        .files
        .iter()
        .filter(|file| {
            pack_key(&file.path)
                .is_some_and(|pack| roots.iter().any(|root| root.eq_ignore_ascii_case(&pack)))
                || is_managed_hud_cfg(&file.path)
                || file.path.ends_with("/autoexec.cfg")
        })
        .collect();
    let mut total = 0u64;
    for file in &files {
        refuse_if_running_among(live_process_names())?;
        let source = exclusive_file_path(profiles, &manifest.id, &file.path);
        let bytes = read_regular_file_bounded_within(profiles, &source, MAX_HUD_ENTRY_BYTES)?
            .ok_or_else(|| {
                ProfileError::Io(format!("{} exceeds the HUD recovery limit.", file.path))
            })?;
        total = total.saturating_add(bytes.len() as u64);
        if total > MAX_HUD_TOTAL_BYTES || !sha256_hex(&bytes).eq_ignore_ascii_case(&file.sha256) {
            return Err(ProfileError::Io(
                "The saved HUD could not be preserved exactly. Its files have not been replaced."
                    .into(),
            ));
        }
        write_atomic_within(profiles, &backup.join("files").join(&file.path), &bytes)
            .map_err(|err| ProfileError::Io(err.to_string()))?;
    }
    let receipt = serde_json::to_vec_pretty(
        &serde_json::json!({"hud": manifest.hud, "roots": roots, "files": files}),
    )
    .map_err(|err| ProfileError::Io(err.to_string()))?;
    write_atomic_within(profiles, &backup.join("original-huds.json"), &receipt)
        .map_err(|err| ProfileError::Io(err.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::{create_profile_record_to, set_active_profile_to};

    const INFO: &[u8] = b"\"HUD\" { \"ui_version\" \"3\" }\n";

    fn setup() -> (PathBuf, PathBuf, PathBuf, String) {
        let area = crate::test_temp_dir();
        let profiles = area.join("profiles");
        let root = area.join("tf2");
        fs::create_dir_all(root.join("tf/cfg")).unwrap();
        fs::write(root.join("tf/steam.inf"), b"appID=440\n").unwrap();
        fs::write(root.join("tf/cfg/config.cfg"), b"unbindall\n").unwrap();
        let library =
            create_profile_record_to(&profiles, &root, "Main", Vec::<String>::new()).unwrap();
        let id = library.profiles[0].id.clone();
        set_active_profile_to(&profiles, &root, &id, Vec::<String>::new()).unwrap();
        (area, profiles, root, id)
    }

    fn tree(payload: &[u8]) -> HudTree {
        HudTree {
            files: BTreeMap::from([
                ("info.vdf".into(), INFO.to_vec()),
                ("resource/ui/layout.res".into(), payload.to_vec()),
            ]),
        }
    }

    fn install(
        profiles: &Path,
        root: &Path,
        profile: &str,
        name: &str,
        payload: &[u8],
    ) -> Result<ProfileDetail, ProfileError> {
        install_hud_pack_to(
            profiles,
            root,
            profile,
            &tree(payload),
            HudRecord {
                id: name.into(),
                hash: None,
                source: HudSource::Local,
                options: BTreeMap::new(),
            },
            Vec::<String>::new(),
        )
    }

    fn opts() -> crate::absorb::AbsorbOptions<'static> {
        crate::absorb::AbsorbOptions {
            cloud_config: None,
            steam_roots: Some(&[]),
        }
    }

    #[test]
    fn replacement_absorb_and_switch_never_readopt_recovery_copies() {
        let (area, profiles, root, id) = setup();
        install(&profiles, &root, &id, "first", b"first exact bytes").unwrap();
        fs::write(root.join("tf/custom/first/untracked.txt"), b"handwritten").unwrap();
        install(&profiles, &root, &id, "second", b"second exact bytes").unwrap();
        crate::absorb::absorb_packs_to(
            &profiles,
            &root,
            crate::absorb::PackChoice::Update,
            Vec::<String>::new(),
            opts(),
        )
        .unwrap();
        let other = create_profile_record_to(&profiles, &root, "Other", Vec::<String>::new())
            .unwrap()
            .profiles
            .into_iter()
            .find(|profile| profile.id != id)
            .unwrap()
            .id;
        crate::switch::switch_profile_to(
            &profiles,
            &root,
            &other,
            Vec::<String>::new(),
            opts(),
            |_| {},
        )
        .unwrap();
        crate::switch::switch_profile_to(
            &profiles,
            &root,
            &id,
            Vec::<String>::new(),
            opts(),
            |_| {},
        )
        .unwrap();
        assert_eq!(live_hud_keys(&root), ["second"]);
        assert_eq!(
            manifest_hud_packs(&load_manifest(&profiles, &id).unwrap()),
            ["second"]
        );
        let copies: Vec<_> = fs::read_dir(root.join("tf/custom").join(HUD_BACKUP_CONTAINER))
            .unwrap()
            .map(|entry| entry.unwrap().path().join("first/untracked.txt"))
            .filter(|path| path.is_file())
            .collect();
        assert_eq!(copies.len(), 1);
        assert_eq!(fs::read(&copies[0]).unwrap(), b"handwritten");
        let library_copies: Vec<_> = fs::read_dir(profiles.join(&id).join("hud-backups"))
            .unwrap()
            .map(|entry| {
                entry
                    .unwrap()
                    .path()
                    .join("files/tf/custom/first/resource/ui/layout.res")
            })
            .filter(|path| path.is_file())
            .collect();
        assert_eq!(library_copies.len(), 1);
        assert_eq!(fs::read(&library_copies[0]).unwrap(), b"first exact bytes");
        fs::remove_dir_all(area).unwrap();
    }

    #[test]
    fn live_review_binds_choice_to_exact_bytes_and_preserves_the_other_hud() {
        let (area, profiles, root, id) = setup();
        install(&profiles, &root, &id, "first", b"saved first").unwrap();
        fs::create_dir_all(root.join("tf/custom/-Second/resource/ui")).unwrap();
        fs::write(root.join("tf/custom/-Second/info.vdf"), INFO).unwrap();
        fs::write(
            root.join("tf/custom/-Second/resource/ui/layout.res"),
            b"second original",
        )
        .unwrap();
        let err = crate::absorb::absorb_packs_to(
            &profiles,
            &root,
            crate::absorb::PackChoice::Update,
            Vec::<String>::new(),
            opts(),
        )
        .unwrap_err();
        assert_eq!(err, ProfileError::HudLiveReviewRequired);
        let stale = get_hud_ownership_to(&profiles, &root, &id).unwrap();
        assert!(stale.review_required);
        assert_eq!(stale.candidates.len(), 2);
        fs::write(
            root.join("tf/custom/-Second/resource/ui/layout.res"),
            b"second edited",
        )
        .unwrap();
        assert!(select_profile_hud_to(
            &profiles,
            &root,
            &id,
            "-Second",
            &stale.fingerprint,
            Vec::<String>::new()
        )
        .unwrap_err()
        .message()
        .contains("changed after review"));
        assert_eq!(live_hud_names(&root).len(), 2);
        let review = get_hud_ownership_to(&profiles, &root, &id).unwrap();
        assert_eq!(
            select_profile_hud_to(
                &profiles,
                &root,
                &id,
                "-Second",
                &review.fingerprint,
                ["tf_win64.exe"]
            )
            .unwrap_err(),
            ProfileError::GameRunning
        );
        select_profile_hud_to(
            &profiles,
            &root,
            &id,
            "-Second",
            &review.fingerprint,
            Vec::<String>::new(),
        )
        .unwrap();
        assert_eq!(live_hud_keys(&root), ["second"]);
        assert_eq!(
            fs::read(root.join("tf/custom/second/resource/ui/layout.res")).unwrap(),
            b"second edited"
        );
        assert!(
            !crate::absorb::scan_absorb_delta_to(&profiles, &root, opts())
                .unwrap()
                .has_pack_changes()
        );
        fs::remove_dir_all(area).unwrap();
    }

    #[test]
    fn same_hud_update_preserves_old_library_and_a_failed_backup_cannot_publish() {
        let (area, profiles, root, id) = setup();
        install(&profiles, &root, &id, "hud", b"before").unwrap();
        let backup_root = profiles.join(&id).join("hud-backups");
        fs::write(&backup_root, b"unrelated file").unwrap();
        let before = load_manifest(&profiles, &id).unwrap();
        assert!(install(&profiles, &root, &id, "hud", b"after").is_err());
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        assert_eq!(
            fs::read(root.join("tf/custom/hud/resource/ui/layout.res")).unwrap(),
            b"before"
        );
        fs::remove_file(&backup_root).unwrap();
        install(&profiles, &root, &id, "hud", b"after").unwrap();
        assert_eq!(live_hud_keys(&root), ["hud"]);
        assert_eq!(
            fs::read(root.join("tf/custom/hud/resource/ui/layout.res")).unwrap(),
            b"after"
        );
        let copy = fs::read_dir(backup_root)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path()
            .join("files/tf/custom/hud/resource/ui/layout.res");
        assert_eq!(fs::read(copy).unwrap(), b"before");
        fs::remove_dir_all(area).unwrap();
    }

    #[test]
    fn mods_refuse_a_real_hud_in_a_batch_without_misclassifying_other_info_files() {
        let (area, profiles, root, id) = setup();
        let ordinary = crate::mods::ModContent::Tree(vec![
            (
                "info.vdf".into(),
                b"\"Addon\" { \"version\" \"3\" }".to_vec(),
            ),
            ("materials/test.vmt".into(), b"material".to_vec()),
        ]);
        let hud = crate::mods::ModContent::Tree(tree(b"hud").files.into_iter().collect());
        let before = load_manifest(&profiles, &id).unwrap();
        let err = crate::mods::install_mods_to(
            &profiles,
            &root,
            &id,
            vec![("ordinary".into(), ordinary.clone()), ("hud".into(), hud)],
            crate::mods::ModSource::Local,
            Vec::<String>::new(),
        )
        .unwrap_err();
        assert_eq!(err.code(), "HudImportRequired");
        assert!(err.message().contains("No selected files were installed"));
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        assert!(!root.join("tf/custom/ordinary").exists());
        crate::mods::install_mod_to(
            &profiles,
            &root,
            &id,
            "ordinary",
            ordinary,
            crate::mods::ModSource::Local,
            Vec::<String>::new(),
        )
        .unwrap();
        assert!(manifest_hud_packs(&load_manifest(&profiles, &id).unwrap()).is_empty());
        assert!(root.join("tf/custom/ordinary/materials/test.vmt").is_file());
        fs::remove_dir_all(area).unwrap();
    }

    #[test]
    fn replacement_removes_uppercase_owned_roots_and_keeps_exact_recovery_bytes() {
        let (area, profiles, root, id) = setup();
        crate::profile::put_exclusive_file_to(
            &profiles,
            &root,
            &id,
            "tf/custom/MixedCase/info.vdf",
            INFO,
            Vec::<String>::new(),
        )
        .unwrap();
        fs::create_dir_all(root.join("tf/custom/MixedCase")).unwrap();
        fs::write(root.join("tf/custom/MixedCase/info.vdf"), INFO).unwrap();
        install(&profiles, &root, &id, "newhud", b"new").unwrap();
        let manifest = load_manifest(&profiles, &id).unwrap();
        assert!(manifest
            .files
            .iter()
            .all(|file| !file.path.contains("MixedCase")));
        assert_eq!(live_hud_keys(&root), ["newhud"]);
        let backup = fs::read_dir(profiles.join(&id).join("hud-backups"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path()
            .join("files/tf/custom/MixedCase/info.vdf");
        assert_eq!(fs::read(backup).unwrap(), INFO);
        fs::remove_dir_all(area).unwrap();
    }

    #[test]
    fn final_review_check_refuses_a_live_edit_that_arrives_during_staging() {
        let (area, profiles, root, id) = setup();
        install(&profiles, &root, &id, "first", b"original").unwrap();
        let review = get_hud_ownership_to(&profiles, &root, &id).unwrap();
        let live = root.join("tf/custom/first/resource/ui/layout.res");
        let injected = std::rc::Rc::new(std::cell::Cell::new(false));
        let fired = injected.clone();
        let before = load_manifest(&profiles, &id).unwrap();
        let result = crate::profile::with_profile_process_sampler(
            move || {
                if !fired.replace(true) {
                    fs::write(&live, b"outside edit during staging").unwrap();
                }
                Vec::new()
            },
            || {
                select_profile_hud_to(
                    &profiles,
                    &root,
                    &id,
                    "first",
                    &review.fingerprint,
                    Vec::<String>::new(),
                )
            },
        );
        assert!(injected.get());
        assert!(result
            .unwrap_err()
            .message()
            .contains("changed after review"));
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        assert_eq!(
            fs::read(root.join("tf/custom/first/resource/ui/layout.res")).unwrap(),
            b"outside edit during staging"
        );
        fs::remove_dir_all(area).unwrap();
    }

    fn install_with_options(profiles: &Path, root: &Path, id: &str) {
        install_hud_pack_with_cfgs_to(
            profiles,
            root,
            id,
            &tree(b"original HUD"),
            HudRecord {
                id: "first".into(),
                hash: None,
                source: HudSource::Local,
                options: BTreeMap::new(),
            },
            &[(
                "tf/cfg/execs_hud_first.cfg".into(),
                b"echo saved option\n".to_vec(),
            )],
            Vec::<String>::new(),
        )
        .unwrap();
    }

    #[test]
    fn replacement_refuses_live_only_cfg_edits_without_changing_either_original() {
        for path in ["tf/cfg/autoexec.cfg", "tf/cfg/execs_hud_first.cfg"] {
            let (area, profiles, root, id) = setup();
            install_with_options(&profiles, &root, &id);
            let before = load_manifest(&profiles, &id).unwrap();
            let saved = fs::read(exclusive_file_path(&profiles, &id, path)).unwrap();
            let mut edited = saved.clone();
            edited.extend_from_slice(b"echo handwritten live edit\n");
            fs::write(root.join(path), &edited).unwrap();
            let result = install(&profiles, &root, &id, "second", b"replacement");
            assert!(result
                .unwrap_err()
                .message()
                .contains("changed outside this profile"));
            assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
            assert_eq!(
                fs::read(exclusive_file_path(&profiles, &id, path)).unwrap(),
                saved
            );
            assert_eq!(fs::read(root.join(path)).unwrap(), edited);
            assert_eq!(live_hud_keys(&root), ["first"]);
            assert!(!profiles.join(&id).join("hud-backups").exists());
            fs::remove_dir_all(area).unwrap();
        }
    }

    #[test]
    fn replacement_rechecks_live_cfg_after_transaction_staging() {
        let (area, profiles, root, id) = setup();
        install_with_options(&profiles, &root, &id);
        let path = "tf/cfg/autoexec.cfg";
        let before = load_manifest(&profiles, &id).unwrap();
        let saved = fs::read(exclusive_file_path(&profiles, &id, path)).unwrap();
        let mut edited = saved.clone();
        edited.extend_from_slice(b"echo edit during transaction staging\n");
        let injected = std::rc::Rc::new(std::cell::Cell::new(false));
        let fired = injected.clone();
        let live = root.join(path);
        let next = edited.clone();
        let result = crate::profile::with_profile_process_sampler(
            move || {
                if !fired.replace(true) {
                    fs::write(&live, &next).unwrap();
                }
                Vec::new()
            },
            || install(&profiles, &root, &id, "second", b"replacement"),
        );
        assert!(injected.get());
        assert!(result
            .unwrap_err()
            .message()
            .contains("changed outside this profile"));
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        assert_eq!(
            fs::read(exclusive_file_path(&profiles, &id, path)).unwrap(),
            saved
        );
        assert_eq!(fs::read(root.join(path)).unwrap(), edited);
        assert_eq!(live_hud_keys(&root), ["first"]);
        fs::remove_dir_all(area).unwrap();
    }

    #[test]
    fn new_hud_options_refuse_an_untracked_live_autoexec() {
        let (area, profiles, root, id) = setup();
        let original = b"echo handwritten startup\n";
        fs::write(root.join("tf/cfg/autoexec.cfg"), original).unwrap();
        let before = load_manifest(&profiles, &id).unwrap();
        let result = install_hud_pack_with_cfgs_to(
            &profiles,
            &root,
            &id,
            &tree(b"new HUD"),
            HudRecord {
                id: "newhud".into(),
                hash: None,
                source: HudSource::Local,
                options: BTreeMap::new(),
            },
            &[(
                "tf/cfg/execs_hud_newhud.cfg".into(),
                b"echo new option\n".to_vec(),
            )],
            Vec::<String>::new(),
        );
        assert!(result
            .unwrap_err()
            .message()
            .contains("changed outside this profile"));
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        assert_eq!(
            fs::read(root.join("tf/cfg/autoexec.cfg")).unwrap(),
            original
        );
        assert!(!root.join("tf/custom/newhud").exists());
        fs::remove_dir_all(area).unwrap();
    }

    #[test]
    fn unreadable_hud_metadata_never_disappears_from_review() {
        let (area, profiles, root, id) = setup();
        install(&profiles, &root, &id, "first", b"original").unwrap();
        fs::create_dir_all(root.join("tf/custom/external/info.vdf")).unwrap();
        assert!(get_hud_ownership_to(&profiles, &root, &id).is_err());
        assert!(install(&profiles, &root, &id, "second", b"new").is_err());
        assert_eq!(
            load_manifest(&profiles, &id).unwrap().hud.unwrap().id,
            "first"
        );
        assert_eq!(
            fs::read(root.join("tf/custom/first/resource/ui/layout.res")).unwrap(),
            b"original"
        );
        fs::remove_dir_all(area).unwrap();
    }

    #[test]
    fn hud_vpk_refusal_applies_to_mods_and_legacy_switch_without_touching_originals() {
        let (area, profiles, root, id) = setup();
        let vpk = crate::vpk::write_vpk_v1(&BTreeMap::from([("info.vdf".into(), INFO.to_vec())]));
        let err = crate::mods::install_mod_to(
            &profiles,
            &root,
            &id,
            "hud",
            crate::mods::ModContent::Vpk(vpk.clone()),
            crate::mods::ModSource::Local,
            Vec::<String>::new(),
        )
        .unwrap_err();
        assert_eq!(err.code(), "HudImportRequired");
        assert!(err.message().contains("cannot import a VPK directly"));
        crate::profile::put_exclusive_file_to(
            &profiles,
            &root,
            &id,
            "tf/custom/legacy.vpk",
            &vpk,
            Vec::<String>::new(),
        )
        .unwrap();
        let before = load_manifest(&profiles, &id).unwrap();
        assert_eq!(
            crate::switch::validate_profile_switch_target(&profiles, &root, &id)
                .unwrap_err()
                .code(),
            "HudImportRequired"
        );
        assert_eq!(
            crate::switch::switch_profile_to(
                &profiles,
                &root,
                &id,
                Vec::<String>::new(),
                opts(),
                |_| {}
            )
            .unwrap_err()
            .code(),
            "HudImportRequired"
        );
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        assert_eq!(
            fs::read(exclusive_file_path(&profiles, &id, "tf/custom/legacy.vpk")).unwrap(),
            vpk
        );
        crate::zip::export_profile_to(&profiles, &root, &id, &area.join("preserved.zip")).unwrap();
        fs::remove_dir_all(area).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn live_case_collisions_require_source_repair_and_never_drop_a_review_candidate() {
        let (area, profiles, root, id) = setup();
        for name in ["Example", "example"] {
            fs::create_dir_all(root.join("tf/custom").join(name)).unwrap();
            fs::write(root.join("tf/custom").join(name).join("info.vdf"), INFO).unwrap();
        }
        assert!(get_hud_ownership_to(&profiles, &root, &id)
            .unwrap_err()
            .message()
            .contains("differ only by case"));
        assert_eq!(live_hud_names_checked(&root).unwrap().len(), 2);
        fs::remove_dir_all(area).unwrap();
    }
}
