//! The Mods pane's own mods: the user's files, and GameBanana.
//!
//! A mod is a top-level `tf/custom` pack owned by the active profile. Getting
//! one in goes through the reviewed chooser in [`super::mod_import`]; these
//! commands manage what is installed and browse GameBanana — switching,
//! export/import and absorb already carry the rest.

use execs_core::mods::ModSource;
use execs_core::ProfileDetail;

use super::shared::{blocking, with_profile};
use crate::error::CommandError;
use crate::gamebanana::{
    self, FileUse, GameBananaCategory, GameBananaDownloadVariant, GameBananaPage, GameBananaSection,
};
use crate::WriteGate;

#[tauri::command]
pub async fn remove_mod(
    gate: tauri::State<'_, WriteGate>,
    id: String,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| Ok(execs_core::mods::remove_mod(&root, &profile_id, &id)?))
        .await
}

#[tauri::command]
pub async fn set_mod_enabled(
    gate: tauri::State<'_, WriteGate>,
    id: String,
    enabled: bool,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        Ok(execs_core::mods::set_mod_enabled(
            &root,
            &profile_id,
            &id,
            enabled,
        )?)
    })
    .await
}

#[tauri::command]
pub async fn copy_mod_to_profile(
    gate: tauri::State<'_, WriteGate>,
    id: String,
    target_profile_id: String,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        Ok(execs_core::mods::copy_mod_to_profile(
            &root,
            &profile_id,
            &id,
            &target_profile_id,
        )?)
    })
    .await
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModUpdateStatus {
    id: String,
    updated_at: Option<i64>,
    update_available: bool,
    error: Option<String>,
}

#[tauri::command]
pub async fn check_mod_updates() -> Result<Vec<ModUpdateStatus>, CommandError> {
    with_profile(move |_root, profile_id| {
        let manifest =
            execs_core::profile::load_manifest(&execs_core::profiles_dir(), &profile_id)?;
        let records: Vec<_> = manifest
            .mods
            .iter()
            .filter(|r| matches!(r.source, ModSource::Gamebanana { .. }))
            .collect();
        if records.len() > 128 {
            return Err(CommandError::unknown(
                "Check updates supports up to 128 GameBanana packs at once.",
            ));
        }
        let mut checked = std::collections::BTreeMap::new();
        Ok(records
            .into_iter()
            .map(|record| {
                let ModSource::Gamebanana { id, url } = &record.source else {
                    unreachable!()
                };
                // A sound pack's saved page is `/sounds/<id>`; GameBanana
                // numbers sounds and mods separately.
                let section = GameBananaSection::of_page_url(url);
                let result = checked
                    .entry((section, *id))
                    .or_insert_with(|| gamebanana::submission_profile(section, *id));
                match result {
                    Ok(profile) => {
                        let available = profile.updated_at.and_then(|date| {
                            execs_core::mods::mod_update_available(&record.installed_at, date)
                        });
                        ModUpdateStatus {
                            id: record.id.clone(),
                            updated_at: profile.updated_at,
                            update_available: available.unwrap_or(false),
                            error: available.is_none().then(|| {
                                "The installed or author update date is unavailable.".into()
                            }),
                        }
                    }
                    Err(error) => ModUpdateStatus {
                        id: record.id.clone(),
                        updated_at: None,
                        update_available: false,
                        error: Some(error.clone()),
                    },
                }
            })
            .collect())
    })
    .await
}

/// One page of TF2 mods (or, with `section: "sound"`, sounds) from GameBanana.
///
/// Browse and name search share the index endpoint, so GameBanana applies the
/// selected sort and supported filters to the whole result set. `refresh`
/// bypasses a still-fresh native cache entry without changing the canonical
/// request URL.
#[tauri::command]
pub async fn search_gamebanana_mods(
    section: Option<String>,
    query: String,
    sort: String,
    category: Option<u64>,
    page: u32,
    include_mature: Option<bool>,
    refresh: Option<bool>,
) -> Result<GameBananaPage, CommandError> {
    let include_mature = include_mature.unwrap_or(false);
    let refresh = refresh.unwrap_or(false);
    let section = GameBananaSection::parse(section.as_deref())?;
    blocking(move || {
        Ok(gamebanana::search_mods(
            section,
            &query,
            &sort,
            category,
            page,
            include_mature,
            refresh,
        )?)
    })
    .await
}

#[tauri::command]
pub async fn gamebanana_mod_categories(
    section: Option<String>,
    refresh: Option<bool>,
) -> Result<Vec<GameBananaCategory>, CommandError> {
    let section = GameBananaSection::parse(section.as_deref())?;
    blocking(move || Ok(gamebanana::categories(section, refresh.unwrap_or(false))?)).await
}

/// Show the author's file names and descriptions before a specific file is
/// downloaded. The selected id is rechecked against a fresh page at install.
/// `forSounds` marks loose WAV/MP3/Ogg files usable for a hit or kill sound.
#[tauri::command]
pub async fn gamebanana_download_variants(
    id: u64,
    section: Option<String>,
    for_sounds: Option<bool>,
) -> Result<Vec<GameBananaDownloadVariant>, CommandError> {
    let section = GameBananaSection::parse(section.as_deref())?;
    let file_use = if for_sounds.unwrap_or(false) {
        FileUse::Sound
    } else {
        FileUse::Pack
    };
    blocking(move || Ok(gamebanana::download_variants_in(section, id, file_use)?)).await
}
