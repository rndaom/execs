//! Profile-owned selections projected into the install's shared preloader files.
use std::path::{Path, PathBuf};

use crate::hash::{sha256_file, write_atomic_within};
use crate::process_lock::refuse_if_running_among;
use crate::profile::profile_live_process_names as live_process_names;
use crate::profile::{
    load_library_from, load_manifest, mutate_profile_files_to, ProfileError, ProfileLiveProjection,
};
use crate::vpk::map_vpk_entries;

use super::apply::{
    apply_preloader_selection_transactional, prepare_preloader_selection, PreloaderReport,
    PreloaderSelection,
};
use super::state::{app_dir_within, load_state, misc_vpk_path, PreloaderState};

pub const MODS_RELEASE: &str = "v1.7.1";
pub const MODS_SHA256: &str = "bd132d03eda6db17544cb43b5b4b57dc94e0cb91d1ab3de9571faabfce235388";

#[derive(Clone)]
pub struct ProfileContext {
    pub profiles: PathBuf,
    pub id: String,
}

impl PreloaderSelection {
    pub fn is_empty(&self) -> bool {
        self.addons.is_empty()
            && self.particle_mods.is_empty()
            && self.profile_particle_mods.is_empty()
    }

    pub(crate) fn validate(&self) -> Result<(), ProfileError> {
        for values in [
            &self.addons,
            &self.particle_mods,
            &self.profile_particle_mods,
        ] {
            if values.len() > 1024
                || values
                    .iter()
                    .any(|v| v.is_empty() || v.len() > 256 || v.chars().any(char::is_control))
            {
                return Err(ProfileError::Io(
                    "Invalid profile preloader selection.".into(),
                ));
            }
        }
        Ok(())
    }
}

fn selection(state: &PreloaderState) -> PreloaderSelection {
    PreloaderSelection {
        addons: state.addons.clone(),
        particle_mods: state.particle_mods.clone(),
        profile_particle_mods: state.profile_particle_mods.clone(),
    }
}

fn data_dir(profiles: &Path) -> Result<&Path, ProfileError> {
    profiles
        .parent()
        .ok_or_else(|| ProfileError::Io("The profile library has no data folder.".into()))
}

/// A live owner is authoritative even if a metadata write was interrupted.
/// Legacy global selections belong only to previously recorded preload users.
pub fn selection_for_export(
    profiles: &Path,
    id: &str,
) -> Result<Option<PreloaderSelection>, ProfileError> {
    let state = load_state(data_dir(profiles)?).map_err(ProfileError::Io)?;
    let owns = state.selection_profile.as_deref() == Some(id)
        || (state.selection_profile.is_none()
            && state.preload_profiles.iter().any(|p| p == id)
            && load_manifest(profiles, id)?.preloader.is_none());
    if !owns {
        return Ok(None);
    }
    let manifest = load_manifest(profiles, id)?;
    let mut chosen = selection(&state);
    chosen
        .profile_particle_mods
        .retain(|id| manifest.mods.iter().any(|m| &m.id == id));
    Ok(Some(chosen))
}

/// Save before replacing the shared projection. A newly imported profile is
/// never enrolled in migration just because it happens to be active.
pub fn capture_installed_selections(
    profiles: &Path,
    root: &Path,
    running: &[String],
) -> Result<(), ProfileError> {
    let state = load_state(data_dir(profiles)?).map_err(ProfileError::Io)?;
    let ids = state.selection_profile.iter().cloned().collect::<Vec<_>>();
    let owners = if state.selection_profile.is_some() {
        &ids
    } else {
        &state.preload_profiles
    };
    if owners.is_empty() {
        return Ok(());
    }
    let library = load_library_from(profiles, Some(root))?;
    for id in owners {
        if !library.profiles.iter().any(|p| &p.id == id) {
            continue;
        }
        let manifest = load_manifest(profiles, id)?;
        if state.selection_profile.is_none() && manifest.preloader.is_some() {
            continue;
        }
        let mut chosen = selection(&state);
        // Legacy global particle ids can name packs on another profile.
        chosen
            .profile_particle_mods
            .retain(|id| manifest.mods.iter().any(|m| &m.id == id));
        if manifest.preloader.as_ref() == Some(&chosen) {
            continue;
        }
        mutate_profile_files_to(
            profiles,
            root,
            id,
            &[],
            &[],
            ProfileLiveProjection::LibraryOnly,
            running,
            |manifest| {
                manifest.preloader = Some(chosen);
                Ok(())
            },
        )?;
    }
    Ok(())
}

pub struct ProfilePreloaderPlan {
    data: PathBuf,
    zip: PathBuf,
    profile: ProfileContext,
    selection: PreloaderSelection,
}

/// Validate the target while the old profile is still intact. Empty targets
/// need no downloaded library, including after the user clears the cache.
pub fn prepare_profile_preloader(
    profiles: &Path,
    root: &Path,
    id: &str,
) -> Result<Option<ProfilePreloaderPlan>, ProfileError> {
    refuse_if_running_among(live_process_names())?;
    let data = data_dir(profiles)?.to_path_buf();
    let selection = load_manifest(profiles, id)?.preloader.unwrap_or_default();
    selection.validate()?;
    let mut state = load_state(&data).map_err(ProfileError::Io)?;
    let snapshots_present = app_dir_within(&data, &data.join("preloader/originals"), false)
        .map_err(ProfileError::Io)?;
    if !snapshots_present
        && selection.is_empty()
        && !super::state::live_file_exists_within(
            root,
            &root.join("tf/custom").join(super::PRELOADER_VPK),
        )
        .map_err(|e| ProfileError::Io(e.to_string()))?
        && state.addons.is_empty()
        && state.particle_mods.is_empty()
        && state.profile_particle_mods.is_empty()
        && state.patched.is_empty()
    {
        return Ok(None);
    }
    let zip = if selection.is_empty() {
        let folder = data.join("preloader");
        app_dir_within(&data, &folder, true).map_err(ProfileError::Io)?;
        let zip = folder.join("empty-mods.zip");
        write_atomic_within(
            &data,
            &zip,
            b"PK\x05\x06\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
        )
        .map_err(|e| ProfileError::Io(e.to_string()))?;
        zip
    } else {
        let zip = data
            .join("preloader")
            .join(format!("mods-{MODS_RELEASE}.zip"));
        if std::fs::metadata(&zip).map(|m| m.len()).ok() != Some(81_529_475)
            || sha256_file(&zip).ok().as_deref() != Some(MODS_SHA256)
        {
            return Err(ProfileError::Io(
                "Download the default mod library in Mods before switching to this profile.".into(),
            ));
        }
        zip
    };
    let profile = ProfileContext {
        profiles: profiles.to_path_buf(),
        id: id.to_string(),
    };
    let entries =
        map_vpk_entries(&misc_vpk_path(root)).map_err(|e| ProfileError::Io(e.message()))?;
    super::state::discover_orphaned_snapshots_readonly(&data, &mut state, Some(&entries));
    prepare_preloader_selection(
        root,
        &data,
        &zip,
        &selection,
        &state,
        &entries,
        Some(&profile),
    )
    .map_err(ProfileError::Io)?;
    Ok(Some(ProfilePreloaderPlan {
        data,
        zip,
        profile,
        selection,
    }))
}

impl ProfilePreloaderPlan {
    pub fn apply(&self, root: &Path, running: &[String]) -> Result<(), ProfileError> {
        apply_profile_preloader(
            root,
            &self.data,
            &self.zip,
            &self.selection,
            &self.profile,
            running,
            &live_process_names,
        )
        .map_err(ProfileError::Io)?;
        Ok(())
    }
}

/// The owner marker commits in the same recovery transaction as the bytes.
pub fn apply_profile_preloader(
    root: &Path,
    data: &Path,
    zip: &Path,
    selection: &PreloaderSelection,
    profile: &ProfileContext,
    running: &[String],
    sampler: &dyn Fn() -> Vec<String>,
) -> Result<PreloaderReport, String> {
    refuse_if_running_among(running).map_err(|e| e.message().to_string())?;
    selection.validate().map_err(|e| e.message())?;
    apply_preloader_selection_transactional(
        root,
        data,
        zip,
        selection,
        running,
        sampler,
        &|| Ok(()),
        Some(profile),
    )
}

/// Save-current captures the installed surface, including its shared mods.
pub(crate) fn selection_for_snapshot(
    profiles: &Path,
) -> Result<Option<PreloaderSelection>, ProfileError> {
    let selected = selection(&load_state(data_dir(profiles)?).map_err(ProfileError::Io)?);
    Ok((!selected.is_empty()).then_some(selected))
}

pub fn clear_saved_profile_selection(
    profiles: &Path,
    root: &Path,
    id: &str,
    running: &[String],
) -> Result<(), ProfileError> {
    mutate_profile_files_to(
        profiles,
        root,
        id,
        &[],
        &[],
        ProfileLiveProjection::LibraryOnly,
        running,
        |manifest| {
            manifest.preloader = Some(PreloaderSelection::default());
            Ok(())
        },
    )?;
    Ok(())
}
