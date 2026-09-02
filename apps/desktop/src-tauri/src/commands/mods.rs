//! The Mods pane's own mods: the user's files, and GameBanana.
//!
//! A mod is a top-level `tf/custom` pack owned by the active profile, so these
//! commands only have to get the bytes in, name the pack, and take it out
//! again — switching, export/import and absorb already carry the rest.

use std::path::{Path, PathBuf};

use execs_core::mods::{ModContent, ModSource};
use execs_core::ProfileDetail;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::shared::{blocking, with_profile};
use crate::error::CommandError;
use crate::gamebanana::{self, GameBananaCategory, GameBananaPage};
use crate::WriteGate;

/// Install everything the user picked, and report the profile as it ends up.
/// An archive can hold several VPK packs, so one pick can be several mods.
fn install_all(
    root: &Path,
    profile_id: &str,
    packs: Vec<(String, ModContent)>,
    source: &ModSource,
) -> Result<ProfileDetail, CommandError> {
    let mut detail = None;
    for (name, content) in packs {
        detail = Some(execs_core::mods::install_mod(
            root,
            profile_id,
            &name,
            content,
            source.clone(),
        )?);
    }
    detail.ok_or_else(|| CommandError::unknown("That file holds no mod this app can install."))
}

/// Read a picked path into packs: a `.vpk` goes in verbatim, anything else is
/// unpacked as an archive.
fn packs_from_file(path: &Path) -> Result<Vec<(String, ModContent)>, CommandError> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    if name.to_ascii_lowercase().ends_with(".vpk") {
        let (name, content) = execs_core::mods::mod_content_from_vpk_file(path)?;
        return Ok(vec![(name, content)]);
    }
    let bytes = std::fs::read(path).map_err(|err| CommandError::unknown(err.to_string()))?;
    if bytes.starts_with(b"Rar!") {
        return Err(CommandError::unknown(
            "RAR archives cannot be unpacked here. Extract it with 7-Zip, then use Add folder.",
        ));
    }
    Ok(execs_core::mods::mod_content_from_archive(&name, &bytes)?)
}

#[tauri::command]
pub async fn import_mod_archive(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
) -> Result<Option<ProfileDetail>, CommandError> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Add mods (.vpk, .zip or .7z)")
            .add_filter("Mods", &["vpk", "zip", "7z"])
            .blocking_pick_files()
    })
    .await
    .map_err(|err| CommandError::unknown(err.to_string()))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let paths: Vec<PathBuf> = picked
        .into_iter()
        .map(|file| file.into_path())
        .collect::<Result<_, _>>()
        .map_err(|err| CommandError::unknown(err.to_string()))?;
    if paths.is_empty() {
        return Ok(None);
    }
    let _guard = gate.0.lock().await;
    with_profile(move |root, profile_id| {
        // Several files at once are one import: every pack from every file.
        let mut packs = Vec::new();
        for path in &paths {
            packs.extend(packs_from_file(path)?);
        }
        Ok(Some(install_all(
            &root,
            &profile_id,
            packs,
            &ModSource::Local,
        )?))
    })
    .await
}

#[tauri::command]
pub async fn import_mod_folder(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
) -> Result<Option<ProfileDetail>, CommandError> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Add a mod folder")
            .blocking_pick_folder()
    })
    .await
    .map_err(|err| CommandError::unknown(err.to_string()))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path: PathBuf = picked
        .into_path()
        .map_err(|err| CommandError::unknown(err.to_string()))?;
    let _guard = gate.0.lock().await;
    with_profile(move |root, profile_id| {
        let (name, content) = execs_core::mods::mod_content_from_dir(&path)?;
        Ok(Some(install_all(
            &root,
            &profile_id,
            vec![(name, content)],
            &ModSource::Local,
        )?))
    })
    .await
}

#[tauri::command]
pub async fn remove_mod(
    gate: tauri::State<'_, WriteGate>,
    id: String,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.0.lock().await;
    with_profile(move |root, profile_id| Ok(execs_core::mods::remove_mod(&root, &profile_id, &id)?))
        .await
}

/// One page of TF2 mods from GameBanana.
///
/// An empty `query` browses the index, which sorts server-side. A non-empty one
/// searches, and GameBanana's search takes no sort parameter — the page is
/// sorted here, so a search's ordering only holds within the page on screen.
#[tauri::command]
pub async fn search_gamebanana_mods(
    query: String,
    sort: String,
    category: Option<u64>,
    page: u32,
    include_mature: Option<bool>,
) -> Result<GameBananaPage, CommandError> {
    let include_mature = include_mature.unwrap_or(false);
    blocking(move || {
        Ok(gamebanana::search_mods(
            &query,
            &sort,
            category,
            page,
            include_mature,
        )?)
    })
    .await
}

#[tauri::command]
pub async fn gamebanana_mod_categories() -> Result<Vec<GameBananaCategory>, CommandError> {
    blocking(|| Ok(gamebanana::categories()?)).await
}

/// Download a GameBanana mod and install it into the active profile.
///
/// The name and page URL on the record come from `Mod/{id}/ProfilePage` rather
/// than from the caller, so what a profile says it carries is what GameBanana
/// says it is.
#[tauri::command]
pub async fn install_gamebanana_mod(
    gate: tauri::State<'_, WriteGate>,
    id: u64,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.0.lock().await;
    with_profile(move |root, profile_id| {
        let profile = gamebanana::mod_profile(id)?;
        let url = gamebanana::download_url(id)?;
        let bytes = crate::net::download_bytes(&url, gamebanana::MOD_MAX_BYTES)?;
        let file_name = gamebanana::download_file_name(&url);
        let packs = if file_name.to_ascii_lowercase().ends_with(".vpk") {
            vec![(profile.name.clone(), ModContent::Vpk(bytes))]
        } else {
            // The mod's own title names the pack; the file name on GameBanana's
            // CDN is usually an opaque id.
            let mut packs = execs_core::mods::mod_content_from_archive(&profile.name, &bytes)?;
            if packs.len() == 1 {
                packs[0].0 = profile.name.clone();
            }
            packs
        };
        install_all(
            &root,
            &profile_id,
            packs,
            &ModSource::Gamebanana {
                id: profile.id,
                url: profile.url.clone(),
            },
        )
    })
    .await
}
