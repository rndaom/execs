//! The Mods pane's own mods: the user's files, and GameBanana.
//!
//! A mod is a top-level `tf/custom` pack owned by the active profile, so these
//! commands only have to get the bytes in, name the pack, and take it out
//! again — switching, export/import and absorb already carry the rest.

use std::path::{Path, PathBuf};

use execs_core::mods::{ModContent, ModSource, MAX_MOD_BYTES};
use execs_core::{ModBatchBudget, ProfileDetail};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::shared::{archive_too_large, blocking, read_bounded_file, with_profile, ActiveContext};
use crate::error::CommandError;
use crate::gamebanana::{self, GameBananaCategory, GameBananaPage, GameBananaProfile};
use crate::WriteGate;

/// Install everything the user picked, and report the profile as it ends up.
/// An archive can hold several VPK packs, so one pick can be several mods.
fn install_all(
    root: &Path,
    profile_id: &str,
    packs: Vec<(String, ModContent)>,
    source: ModSource,
) -> Result<ProfileDetail, CommandError> {
    if packs.is_empty() {
        return Err(CommandError::unknown(
            "That file holds no mod this app can install.",
        ));
    }
    Ok(execs_core::mods::install_mods(
        root, profile_id, packs, source,
    )?)
}

/// Read a picked path into packs: a `.vpk` goes in verbatim, anything else is
/// unpacked as an archive.
fn packs_from_file(path: &Path) -> Result<Vec<(String, ModContent)>, CommandError> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    if name.to_ascii_lowercase().ends_with(".vpk") {
        // Core probes the VPK's size on disk before reading it.
        let (name, content) = execs_core::mods::mod_content_from_vpk_file(path)?;
        return Ok(vec![(name, content)]);
    }
    let bytes = read_bounded_file(path, MAX_MOD_BYTES, archive_too_large(MAX_MOD_BYTES))?;
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
    let context = with_profile(|root, profile_id| {
        execs_core::refuse_if_running()?;
        Ok(ActiveContext::capture(&root, &profile_id))
    })
    .await?;
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
    let packs = blocking(move || {
        // Several files at once are one import: every pack from every file.
        let mut packs = Vec::new();
        let mut budget = ModBatchBudget::default();
        for path in &paths {
            for pack in packs_from_file(path)? {
                // Reject the aggregate before retaining another individually
                // bounded body; the core install repeats the same check at
                // the final write boundary.
                budget.add(&pack.1)?;
                packs.push(pack);
            }
        }
        Ok(packs)
    })
    .await?;
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        context.ensure_current(&root, &profile_id)?;
        Ok(Some(install_all(
            &root,
            &profile_id,
            packs,
            ModSource::Local,
        )?))
    })
    .await
}

#[tauri::command]
pub async fn import_mod_folder(
    gate: tauri::State<'_, WriteGate>,
    app: AppHandle,
) -> Result<Option<ProfileDetail>, CommandError> {
    let context = with_profile(|root, profile_id| {
        execs_core::refuse_if_running()?;
        Ok(ActiveContext::capture(&root, &profile_id))
    })
    .await?;
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
    let packs = blocking(move || {
        let (name, content) = execs_core::mods::mod_content_from_dir(&path)?;
        let mut budget = ModBatchBudget::default();
        budget.add(&content)?;
        Ok(vec![(name, content)])
    })
    .await?;
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        context.ensure_current(&root, &profile_id)?;
        Ok(Some(install_all(
            &root,
            &profile_id,
            packs,
            ModSource::Local,
        )?))
    })
    .await
}

#[tauri::command]
pub async fn remove_mod(
    gate: tauri::State<'_, WriteGate>,
    id: String,
) -> Result<ProfileDetail, CommandError> {
    let _guard = gate.lock_for_write().await?;
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
///
/// The download (up to 512 MiB) happens before the write gate is taken, so an
/// autosave or absorb is not queued behind a slow link; the running-game
/// check comes first so the user hears "close TF2" before the transfer, not
/// after it.
#[tauri::command]
pub async fn install_gamebanana_mod(
    gate: tauri::State<'_, WriteGate>,
    id: u64,
) -> Result<ProfileDetail, CommandError> {
    let (context, profile, packs) = with_profile(move |root, profile_id| {
        execs_core::refuse_if_running()?;
        let (profile, packs) = fetch_gamebanana_mod(id)?;
        Ok((ActiveContext::capture(&root, &profile_id), profile, packs))
    })
    .await?;
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        context.ensure_current(&root, &profile_id)?;
        install_all(
            &root,
            &profile_id,
            packs,
            ModSource::Gamebanana {
                id: profile.id,
                url: profile.url.clone(),
            },
        )
    })
    .await
}

/// The network half of a GameBanana install: the mod's own record, and its
/// newest file read into packs.
fn fetch_gamebanana_mod(
    id: u64,
) -> Result<(GameBananaProfile, Vec<(String, ModContent)>), CommandError> {
    let profile = gamebanana::mod_profile(id)?;
    let pick = gamebanana::download_url(id)?;
    let bytes = crate::net::download_bytes(&pick.url, gamebanana::MOD_MAX_BYTES)?;
    let packs = packs_from_download(&profile.name, &pick.file_name, bytes)?;
    Ok((profile, packs))
}

/// A bare VPK goes in verbatim; anything else is unpacked as an archive. The
/// uploaded name decides, and the VPK signature decides when the name does
/// not — GameBanana's download URL carries no extension at all.
fn packs_from_download(
    mod_name: &str,
    file_name: &str,
    bytes: Vec<u8>,
) -> Result<Vec<(String, ModContent)>, CommandError> {
    if gamebanana::is_bare_vpk(file_name, &bytes) {
        return Ok(vec![(mod_name.to_string(), ModContent::Vpk(bytes))]);
    }
    // The mod's own title names the pack; the file name on GameBanana's
    // CDN is usually an opaque id.
    let mut packs = execs_core::mods::mod_content_from_archive(mod_name, &bytes)?;
    if packs.len() == 1 {
        packs[0].0 = mod_name.to_string();
    }
    Ok(packs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_gamebanana_download_becomes_a_vpk_pack_by_name_or_signature() {
        let vpk = vec![0x34, 0x12, 0xAA, 0x55, 1, 0, 0, 0, 0, 0, 0, 0];
        // The opaque `dl/<id>` name says nothing; the signature still wins.
        let packs = packs_from_download("Cool Skin", "1234", vpk.clone()).unwrap();
        assert_eq!(packs.len(), 1);
        assert_eq!(packs[0].0, "Cool Skin");
        assert!(matches!(&packs[0].1, ModContent::Vpk(bytes) if *bytes == vpk));

        let packs = packs_from_download("Cool Skin", "cool_skin.vpk", vec![0u8; 4]).unwrap();
        assert!(matches!(packs[0].1, ModContent::Vpk(_)));

        // Neither a VPK nor an archive: the archive reader's own refusal.
        let err = packs_from_download("Cool Skin", "1234", b"not an archive".to_vec()).unwrap_err();
        assert!(!err.message.is_empty());
    }
}
