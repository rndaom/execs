//! Duplicate a saved profile into a new, inactive one. Only library bytes are
//! read; the live TF2 tree is neither read nor written.

use super::*;

/// Copy `source_id` into a new profile named `name` with a fresh id. Every
/// file is copied from the library (exclusive files byte for byte, shared
/// blobs by reference) and must still match the source manifest's hash, so a
/// damaged library file fails the copy instead of spreading. Records and
/// selections come along; Steam launch-option projection starts pending
/// because the copy has never been applied. Creation stages everything and
/// publishes the index last, so a failure leaves no partial profile.
pub fn duplicate_profile_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    source_id: &str,
    name: &str,
    running_names: I,
) -> Result<ProfileLibrary, ProfileError>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let name = normalize_name(name)?;
    if name.chars().any(char::is_control) {
        return Err(ProfileError::InvalidName);
    }
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if !library
        .profiles
        .iter()
        .any(|profile| profile.id == source_id)
    {
        return Err(ProfileError::UnknownProfile);
    }
    let mut source = load_manifest(profiles_dir, source_id)?;
    // Export and duplicate read legacy global preloader choices the same way.
    if let Some(selection) = crate::preloader::selection_for_export(profiles_dir, source_id)? {
        source.preloader = Some(selection);
    }

    let mut puts = Vec::with_capacity(source.files.len());
    for file in &source.files {
        let path = match file.storage {
            FileStorage::Exclusive => exclusive_file_path(profiles_dir, source_id, &file.path),
            FileStorage::Shared => blob_path(profiles_dir, &file.sha256),
        };
        let expected_len = fs::metadata(&path)
            .map_err(|err| ProfileError::Io(format!("{}: {err}", file.path)))?
            .len();
        puts.push((file.path.clone(), path, expected_len));
    }
    let sources: Vec<(String, FileSource<'_>)> = puts
        .iter()
        .map(|(rel, path, expected_len)| {
            (
                rel.clone(),
                FileSource::PathExact {
                    path,
                    expected_len: *expected_len,
                },
            )
        })
        .collect();

    create_populated_profile_to(
        profiles_dir,
        tf2_root,
        &name,
        &sources,
        false,
        running_names,
        move |manifest| {
            let copied: HashMap<&str, &str> = manifest
                .files
                .iter()
                .map(|file| (file.path.as_str(), file.sha256.as_str()))
                .collect();
            for file in &source.files {
                if !copied
                    .get(file.path.as_str())
                    .is_some_and(|hash| hash.eq_ignore_ascii_case(&file.sha256))
                {
                    return Err(ProfileError::Io(format!(
                        "{} no longer matches its saved copy, so the profile was not duplicated.",
                        file.path
                    )));
                }
            }
            manifest.launch_options = source.launch_options;
            manifest.launch_sync_pending = true;
            manifest.hud = source.hud;
            manifest.hud_roots = source.hud_roots;
            manifest.hud_selected_root = source.hud_selected_root;
            manifest.hud_review_pending = source.hud_review_pending;
            manifest.crosshair = source.crosshair;
            manifest.viewmodel = source.viewmodel;
            manifest.hitsound = source.hitsound;
            manifest.mods = source.mods;
            manifest.preloader = Some(source.preloader.unwrap_or_default());
            manifest.ignored_packs = source.ignored_packs;
            Ok(())
        },
    )
}
