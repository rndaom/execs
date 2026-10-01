//! The Sounds pane: hit and kill sounds.

use execs_core::hitsound::HITSOUND_MAX_BYTES;
use execs_core::{
    HitsoundChange, HitsoundEntry, HitsoundKind, HitsoundSource, ProfileDetail, WavInfo,
};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use super::shared::{blocking, read_bounded_file, with_profile, with_root, ActiveContext};
use crate::error::CommandError;
use crate::{HitsoundCacheGate, WriteGate};

/// What a picked WAV past the engine cap is told, before and after reading.
const HITSOUND_TOO_LARGE: &str = "That file is too large for a hit sound (8 MB limit).";
const ABANDONED_PICK_MAX_AGE: std::time::Duration =
    std::time::Duration::from_secs(7 * 24 * 60 * 60);

fn gc_picked_for_library(root: &std::path::Path) -> Result<(), CommandError> {
    let library = execs_core::load_library(Some(root))?;
    let mut referenced = Vec::new();
    for profile in library.profiles {
        let manifest = execs_core::load_manifest(&execs_core::profiles_dir(), &profile.id)?;
        let Some(record) = manifest.hitsound else {
            continue;
        };
        referenced.extend(
            [record.hit, record.kill]
                .into_iter()
                .flatten()
                .filter_map(|entry| entry.token),
        );
    }
    crate::hitsound_fetch::gc_picked(&referenced, ABANDONED_PICK_MAX_AGE)?;
    Ok(())
}

/// One sound the pane can audition or install.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HitsoundPick {
    /// Retained for old IPC callers; new catalog reads are refused.
    Community { name: String },
    /// A user file the dialog already prepared, by its stash token.
    File { token: String, name: String },
    /// What the active profile already has installed in this slot.
    Installed { slot: HitsoundKind },
    /// One of the engine's own sounds, by file stem, from the user's VPK.
    Stock { stem: String },
    /// A comfig.app hits-library entry by its opaque 128-hex object id.
    Comfig { hash: String, name: String },
}

fn retired_catalog_error() -> CommandError {
    CommandError::new(
        "SourceUnavailable",
        "This sound catalog is no longer offered. Saved profile WAVs remain installed; choose your own WAV or a built-in TF2 effect for a new sound.",
    )
}

fn retired_boost_error() -> CommandError {
    CommandError::new(
        "SourceUnavailable",
        "This saved catalog sound cannot be re-encoded from its original source. Keep its current boost or choose your own WAV.",
    )
}

fn require_boostable_source(source: HitsoundSource) -> Result<(), CommandError> {
    match source {
        HitsoundSource::File | HitsoundSource::Comfig => Ok(()),
        HitsoundSource::Community => Err(retired_boost_error()),
    }
}

fn pick_bytes(
    root: &std::path::Path,
    profile_id: &str,
    pick: &HitsoundPick,
) -> Result<Vec<u8>, CommandError> {
    match pick {
        HitsoundPick::Community { name } => {
            let _ = name;
            Err(retired_catalog_error())
        }
        HitsoundPick::Comfig { hash, .. } => Ok(crate::hitsound_fetch::fetch_comfig_wav(hash)?),
        HitsoundPick::File { token, .. } => Ok(crate::hitsound_fetch::read_picked(token)?),
        HitsoundPick::Installed { slot } => {
            execs_core::stored_hitsound(&execs_core::profiles_dir(), profile_id, *slot)
                .ok_or_else(|| CommandError::unknown("Nothing is installed in that slot."))
        }
        HitsoundPick::Stock { stem } => {
            let stock = execs_core::extract_stock_hitsounds(root)?;
            stock
                .get(&stem.to_ascii_lowercase())
                .cloned()
                .ok_or_else(|| CommandError::unknown("That stock sound was not found in the VPK."))
        }
    }
}

/// WAV bytes for the audio element as a `Response`. Saved ADPCM sources are
/// decoded to PCM for preview only; installed files stay unchanged.
#[tauri::command]
pub async fn hitsound_bytes(pick: HitsoundPick) -> Result<tauri::ipc::Response, CommandError> {
    let bytes = with_profile(move |root, profile_id| {
        Ok(execs_core::preview_wav(&pick_bytes(
            &root,
            &profile_id,
            &pick,
        )?))
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// comfig.app's hits library (pinned index, cached), for the browsable list.
#[tauri::command]
pub async fn comfig_hitsound_index(
) -> Result<Vec<crate::hitsound_fetch::ComfigHitsound>, CommandError> {
    blocking(|| Ok(crate::hitsound_fetch::fetch_comfig_index()?)).await
}

/// The stock hit/kill sound stems present in the user's sound VPK.
#[tauri::command]
pub async fn list_stock_hitsounds() -> Result<Vec<String>, CommandError> {
    with_root(|root| {
        Ok(execs_core::extract_stock_hitsounds(&root)?
            .into_keys()
            .collect())
    })
    .await
}

/// Other tf/custom packs with the canonical hit/kill sound virtual paths.
/// These are candidates only; TF2's current in-game winner is not inferred.
#[tauri::command]
pub async fn get_hitsound_sources() -> Result<execs_core::content_index::ContentIndex, CommandError>
{
    with_root(|root| {
        Ok(execs_core::content_index::scan_custom_paths(
            &root,
            &["sound/ui/hitsound.wav", "sound/ui/killsound.wav"],
            Some(execs_core::EXECS_HITSOUNDS_PACK),
        ))
    })
    .await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedHitsound {
    pub token: String,
    pub name: String,
    pub info: WavInfo,
    /// True when the file was re-encoded to something the engine plays.
    pub converted: bool,
}

/// Let the user choose a WAV, MP3 or Ogg Vorbis clip, prepare it for the engine, and stash it for
/// auditioning and a later Apply. Cancelling the dialog returns `None`.
#[tauri::command]
pub async fn pick_hitsound_file(
    app: AppHandle,
    cache_gate: tauri::State<'_, HitsoundCacheGate>,
) -> Result<Option<PickedHitsound>, CommandError> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Choose a sound")
            .add_filter("Sound files", &["wav", "mp3", "ogg", "oga"])
            .blocking_pick_file()
    })
    .await
    .map_err(|err| CommandError::unknown(err.to_string()))?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|err| CommandError::unknown(err.to_string()))?;
    let (name, wav, info, converted) = blocking(move || {
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "sound.wav".into());
        // Refused by its size on disk before it is read whole; the same
        // sentence guards the bytes below for a file that grew in between.
        let raw = read_bounded_file(&path, HITSOUND_MAX_BYTES as u64, HITSOUND_TOO_LARGE)?;
        let (wav, info, converted) = prepare_sound_file(&name, &raw)?;
        Ok((name, wav, info, converted))
    })
    .await?;
    // A concurrent Apply may hold an old picked token while it resolves and
    // commits its manifest reference. Stash and sweep under that same cache
    // lock so neither side can delete the other's in-flight source.
    let _cache_guard = cache_gate.0.lock().await;
    blocking(move || {
        let token = crate::hitsound_fetch::stash_picked(&wav)?;
        if let Some(root) = execs_core::remembered_tf2_root() {
            let _ = gc_picked_for_library(&root);
        }
        Ok(Some(PickedHitsound {
            token,
            name,
            info,
            converted,
        }))
    })
    .await
}

/// MP3 and Ogg Vorbis clips become WAVs first; everything after that is the
/// same preparation a WAV gets. True when the bytes changed.
fn prepare_sound_file(name: &str, raw: &[u8]) -> Result<(Vec<u8>, WavInfo, bool), CommandError> {
    let source = if execs_core::audio_decode::is_decoded_extension(name) {
        let extension = name.rsplit_once('.').map_or("", |(_, extension)| extension);
        execs_core::audio_decode::decode_to_wav(raw, extension)?
    } else {
        raw.to_vec()
    };
    let (wav, info) = execs_core::prepare_hitsound_wav(&source)?;
    let converted = wav != raw;
    Ok((wav, info, converted))
}

/// At most this many sounds from one GameBanana upload reach the library.
const GAMEBANANA_SOUNDS_MAX: usize = 32;

/// Sounds from one GameBanana hit or kill sound upload, prepared like a file
/// the player picked and listed in the Sounds library. Nothing is installed:
/// the player still chooses one with Use.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameBananaSounds {
    /// The slot the upload was made for; either slot accepts it.
    pub slot: HitsoundKind,
    pub title: String,
    pub sounds: Vec<PickedHitsound>,
    /// Audio files that were too large, too long or unreadable.
    pub skipped: usize,
    /// More usable sounds than the library lists for one upload.
    pub truncated: bool,
}

/// The audio files of a download, named by their path below the folders they
/// all share. Hidden files and macOS resource forks are not sounds.
fn audio_members(entries: Vec<(String, Vec<u8>)>) -> Vec<(String, Vec<u8>)> {
    let mut audio: Vec<_> = entries
        .into_iter()
        .filter(|(path, _)| {
            let lower = path.to_ascii_lowercase();
            crate::gamebanana::is_audio_file(&lower)
                && !lower
                    .split('/')
                    .any(|part| part == "__macosx" || part.starts_with('.'))
        })
        .collect();
    audio.sort_by(|a, b| a.0.cmp(&b.0));
    // Folders every sound sits in say nothing about which sound is which.
    let mut shared: Option<Vec<&str>> = None;
    for (path, _) in &audio {
        let dirs: Vec<&str> = path.split('/').collect();
        let dirs = &dirs[..dirs.len() - 1];
        shared = Some(match shared {
            None => dirs.to_vec(),
            Some(current) => current
                .iter()
                .zip(dirs)
                .take_while(|(a, b)| a == b)
                .map(|(a, _)| *a)
                .collect(),
        });
    }
    let prefix = shared.unwrap_or_default().len();
    audio
        .iter()
        .map(|(path, bytes)| {
            let name = path.split('/').skip(prefix).collect::<Vec<_>>().join("/");
            (name, bytes.clone())
        })
        .collect()
}

type PreparedSound = (String, Vec<u8>, WavInfo, bool);

/// The name a GameBanana sound is listed and saved under. Files are usually
/// just `hitsound.wav`, so the upload's title leads.
/// Saved names stay within the profile record's 256-byte, no-control limit.
fn gamebanana_sound_name(title: &str, file: &str, single: bool) -> String {
    let clean = |text: &str| -> String {
        text.chars()
            .map(|c| if c.is_control() { ' ' } else { c })
            .collect::<String>()
            .trim()
            .to_string()
    };
    let title = clean(title);
    let file = clean(file);
    let mut name = match (single, title.is_empty()) {
        (_, true) => file,
        (true, false) => title,
        (false, false) => format!("{title} · {file}"),
    };
    while name.len() > 200 {
        name.pop();
    }
    if name.trim().is_empty() {
        "GameBanana sound".into()
    } else {
        name.trim_end().to_string()
    }
}

/// Prepares every usable sound, skipping the rest. A download with no usable
/// sound is refused with the reason the last candidate failed.
fn prepare_sound_members(
    members: Vec<(String, Vec<u8>)>,
) -> Result<(Vec<PreparedSound>, usize, bool), CommandError> {
    if members.is_empty() {
        return Err(CommandError::unknown(
            "That download has no WAV, MP3 or Ogg sound files.",
        ));
    }
    let mut prepared = Vec::new();
    let mut skipped = 0;
    let mut last_error = None;
    let mut truncated = false;
    for (name, raw) in members {
        if prepared.len() == GAMEBANANA_SOUNDS_MAX {
            truncated = true;
            break;
        }
        let result = if raw.len() > HITSOUND_MAX_BYTES {
            Err(CommandError::unknown(HITSOUND_TOO_LARGE))
        } else {
            prepare_sound_file(&name, &raw)
        };
        match result {
            Ok((wav, info, converted)) => prepared.push((name, wav, info, converted)),
            Err(err) => {
                skipped += 1;
                last_error = Some(err);
            }
        }
    }
    if prepared.is_empty() {
        return Err(last_error
            .unwrap_or_else(|| CommandError::unknown("That download has no usable sounds.")));
    }
    Ok((prepared, skipped, truncated))
}

/// Download one GameBanana hit or kill sound upload and prepare its sounds for
/// the Sounds library. Only Hitsound and Killsound submissions are accepted,
/// and only a file still listed on the upload's page.
#[tauri::command]
pub async fn prepare_gamebanana_hitsounds(
    cache_gate: tauri::State<'_, HitsoundCacheGate>,
    id: u64,
    file_id: u64,
) -> Result<GameBananaSounds, CommandError> {
    use crate::gamebanana::{self, FileUse, GameBananaModRoute, GameBananaSection};
    let (slot, title, prepared, skipped, truncated) = blocking(move || {
        let profile = gamebanana::submission_profile(GameBananaSection::Sound, id)?;
        let slot = match profile.route {
            GameBananaModRoute::HitSound => HitsoundKind::Hit,
            GameBananaModRoute::KillSound => HitsoundKind::Kill,
            GameBananaModRoute::Mod | GameBananaModRoute::Hud => {
                return Err(CommandError::unknown(
                    "That GameBanana sound is not a hit or kill sound. Install it from Mods.",
                ))
            }
        };
        let pick =
            gamebanana::download_file_in(GameBananaSection::Sound, id, file_id, FileUse::Sound)?;
        let bytes = gamebanana::download_pick(&pick)?;
        let members = if gamebanana::is_audio_file(&pick.file_name) {
            vec![(pick.file_name.clone(), bytes)]
        } else {
            let limits = execs_core::archive::ArchiveLimits::new(
                20_000,
                gamebanana::MOD_MAX_BYTES,
                gamebanana::MOD_MAX_BYTES,
            );
            audio_members(execs_core::archive::extract_archive(&bytes, limits)?)
        };
        let (prepared, skipped, truncated) = prepare_sound_members(members)?;
        Ok((slot, profile.name, prepared, skipped, truncated))
    })
    .await?;
    // The same cache lock as a picked file: stashing and sweeping must not
    // race an Apply that is still resolving an earlier token.
    let _cache_guard = cache_gate.0.lock().await;
    blocking(move || {
        let single = prepared.len() == 1;
        let mut sounds = Vec::with_capacity(prepared.len());
        for (name, wav, info, converted) in prepared {
            sounds.push(PickedHitsound {
                token: crate::hitsound_fetch::stash_picked(&wav)?,
                name: gamebanana_sound_name(&title, &name, single),
                info,
                converted,
            });
        }
        if let Some(root) = execs_core::remembered_tf2_root() {
            let _ = gc_picked_for_library(&root);
        }
        Ok(GameBananaSounds {
            slot,
            title,
            sounds,
            skipped,
            truncated,
        })
    })
    .await
}

/// What Apply should do with one slot.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "change", rename_all = "camelCase")]
pub enum HitsoundSlotChange {
    Keep,
    Clear,
    Install {
        pick: HitsoundPick,
        /// 0, 6 or 12 dB applied to the file itself.
        #[serde(default)]
        boost: u8,
    },
}

fn resolve_change(
    root: &std::path::Path,
    profile_id: &str,
    change: HitsoundSlotChange,
) -> Result<HitsoundChange, CommandError> {
    Ok(match change {
        HitsoundSlotChange::Keep => HitsoundChange::Keep,
        HitsoundSlotChange::Clear => HitsoundChange::Clear,
        HitsoundSlotChange::Install { pick, boost } => {
            let boost = execs_core::clamp_boost_db(boost);
            let (entry, raw) =
                match &pick {
                    HitsoundPick::Community { .. } => {
                        return Err(retired_catalog_error());
                    }
                    HitsoundPick::Comfig { name, hash } => {
                        let mut entry = HitsoundEntry::new(name.clone(), HitsoundSource::Comfig);
                        entry.hash = Some(hash.clone());
                        (entry, pick_bytes(root, profile_id, &pick)?)
                    }
                    HitsoundPick::File { name, token } => {
                        let mut entry = HitsoundEntry::new(name.clone(), HitsoundSource::File);
                        entry.token = Some(token.clone());
                        (entry, pick_bytes(root, profile_id, &pick)?)
                    }
                    // Re-install what is already there at a different boost: the
                    // installed bytes are already boosted, so go back to the source.
                    HitsoundPick::Installed { slot } => installed_source(profile_id, *slot)?,
                    HitsoundPick::Stock { .. } => return Err(CommandError::unknown(
                        "Stock sounds are chosen with the effect setting, not installed as files.",
                    )),
                };
            let mut entry = entry;
            entry.boost = boost;
            let (wav, _) = execs_core::prepare_hitsound_wav_boosted(&raw, boost)?;
            HitsoundChange::Install { entry, wav }
        }
    })
}

/// The installed entry of a slot plus its original (unboosted) bytes.
fn installed_source(
    profile_id: &str,
    slot: HitsoundKind,
) -> Result<(HitsoundEntry, Vec<u8>), CommandError> {
    let record = execs_core::load_manifest(&execs_core::profiles_dir(), profile_id)?
        .hitsound
        .unwrap_or_default();
    let entry = match slot {
        HitsoundKind::Hit => record.hit,
        HitsoundKind::Kill => record.kill,
    }
    .ok_or_else(|| CommandError::unknown("Nothing is installed in that slot."))?;
    require_boostable_source(entry.source)?;
    // The installed bytes are the source whenever nothing was baked into them
    // yet; only an already-boosted user file has to go back to its stash.
    let installed = || {
        if entry.boost == 0 {
            execs_core::stored_hitsound(&execs_core::profiles_dir(), profile_id, slot)
        } else {
            None
        }
    };
    let raw = match entry.source {
        HitsoundSource::Community => return Err(retired_boost_error()),
        // A boosted comfig.app sound goes back to the original upload.
        HitsoundSource::Comfig => match entry.hash.as_deref() {
            Some(hash) => crate::hitsound_fetch::fetch_comfig_wav(hash)
                .or_else(|err| installed().ok_or(CommandError::unknown(err)))?,
            None => installed().ok_or_else(|| {
                CommandError::unknown("Pick this sound from the library again to change its boost.")
            })?,
        },
        HitsoundSource::File => entry
            .token
            .as_deref()
            .and_then(|token| crate::hitsound_fetch::read_picked(token).ok())
            .or_else(installed)
            .ok_or_else(|| CommandError::unknown("Pick the file again to change its boost."))?,
    };
    Ok((entry, raw))
}

#[tauri::command]
pub async fn apply_hitsounds(
    gate: tauri::State<'_, WriteGate>,
    cache_gate: tauri::State<'_, HitsoundCacheGate>,
    hit: HitsoundSlotChange,
    kill: HitsoundSlotChange,
) -> Result<ProfileDetail, CommandError> {
    // Keep every picked source alive until the profile manifest names it.
    // This cache-only lock may span a remote fetch, but never blocks unrelated
    // profile writes; all commands that take both locks use cache -> write.
    let _cache_guard = cache_gate.0.lock().await;
    let (context, hit, kill) = with_profile(move |root, profile_id| {
        execs_core::refuse_if_running()?;
        let context = ActiveContext::capture(&root, &profile_id);
        let hit = resolve_change(&root, &profile_id, hit)?;
        let kill = resolve_change(&root, &profile_id, kill)?;
        Ok((context, hit, kill))
    })
    .await?;
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        context.ensure_current(&root, &profile_id)?;
        let detail = execs_core::apply_hitsounds(&root, &profile_id, hit, kill)?;
        // Cache cleanup is post-commit and retryable; it must never make a
        // successful sound install look rolled back to the renderer.
        let _ = gc_picked_for_library(&root);
        Ok(detail)
    })
    .await
}

/// Save the Sounds pane's scoped CFG and changed files in one recoverable
/// profile transaction. Fetching and decoding happen before the write gate;
/// ActiveContext rejects a profile or install change before publication.
#[tauri::command]
pub async fn apply_hitsounds_with_settings(
    gate: tauri::State<'_, WriteGate>,
    cache_gate: tauri::State<'_, HitsoundCacheGate>,
    path: String,
    text: String,
    expected_profile_id: String,
    hit: HitsoundSlotChange,
    kill: HitsoundSlotChange,
) -> Result<ProfileDetail, CommandError> {
    super::files::validate_editor_path(&path)?;
    super::files::validate_editor_text(&text)?;
    let _cache_guard = cache_gate.0.lock().await;
    let (context, hit, kill) = with_profile(move |root, profile_id| {
        if profile_id != expected_profile_id {
            return Err(CommandError::new(
                "ProfileChanged",
                "The active profile changed before saving. Try again.",
            ));
        }
        execs_core::refuse_if_running()?;
        let context = ActiveContext::capture(&root, &profile_id);
        let hit = resolve_change(&root, &profile_id, hit)?;
        let kill = resolve_change(&root, &profile_id, kill)?;
        Ok((context, hit, kill))
    })
    .await?;
    let _guard = gate.lock_for_write().await?;
    with_profile(move |root, profile_id| {
        context.ensure_current(&root, &profile_id)?;
        let detail = execs_core::hitsound::apply_hitsounds_with_settings(
            &root,
            &profile_id,
            &path,
            text.as_bytes(),
            hit,
            kill,
        )?;
        let _ = gc_picked_for_library(&root);
        Ok(detail)
    })
    .await
}

#[tauri::command]
pub async fn remove_hitsounds(
    gate: tauri::State<'_, WriteGate>,
    cache_gate: tauri::State<'_, HitsoundCacheGate>,
) -> Result<ProfileDetail, CommandError> {
    let _cache_guard = cache_gate.0.lock().await;
    let _guard = gate.lock_for_write().await?;
    with_profile(|root, profile_id| {
        let detail = execs_core::remove_hitsounds(&root, &profile_id)?;
        let _ = gc_picked_for_library(&root);
        Ok(detail)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn retired_catalog_picks_refuse_preview_and_install_before_any_fetch_or_cache_read() {
        let root = Path::new("unused");
        {
            let pick = HitsoundPick::Community {
                name: "quack".into(),
            };
            assert_eq!(
                pick_bytes(root, "unused", &pick).unwrap_err().code,
                "SourceUnavailable"
            );
            assert_eq!(
                resolve_change(
                    root,
                    "unused",
                    HitsoundSlotChange::Install { pick, boost: 0 },
                )
                .unwrap_err()
                .code,
                "SourceUnavailable"
            );
        }
    }

    /// A 16-bit mono PCM WAV of `samples` silent frames at 22050 Hz.
    fn pcm_wav(samples: usize) -> Vec<u8> {
        let data = samples * 2;
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&((36 + data) as u32).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&22050u32.to_le_bytes());
        wav.extend_from_slice(&44100u32.to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(data as u32).to_le_bytes());
        wav.resize(44 + data, 0);
        wav
    }

    #[test]
    fn gamebanana_sound_uploads_list_only_audio_named_below_shared_folders() {
        let members = audio_members(vec![
            ("pack/sound/ui/hitsound.wav".into(), vec![1]),
            ("pack/sound/ui/alt/hitsound.wav".into(), vec![2]),
            ("pack/readme.txt".into(), vec![3]),
            ("__MACOSX/pack/sound/ui/._hitsound.wav".into(), vec![4]),
            ("pack/sound/ui/.hidden.mp3".into(), vec![5]),
            ("pack/sound/ui/Kill.OGG".into(), vec![6]),
        ]);
        let names: Vec<_> = members.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(names, ["Kill.OGG", "alt/hitsound.wav", "hitsound.wav"]);

        assert_eq!(
            gamebanana_sound_name("Quake hit", "hitsound.wav", true),
            "Quake hit"
        );
        assert_eq!(
            gamebanana_sound_name("Pack", "alt/hitsound.wav", false),
            "Pack · alt/hitsound.wav"
        );
        let long = gamebanana_sound_name(&"é".repeat(300), "a.wav", false);
        assert!(long.len() <= 200 && !long.is_empty());
        assert_eq!(
            gamebanana_sound_name(
                "
", "a.wav", true
            ),
            "a.wav"
        );
        assert_eq!(gamebanana_sound_name("", "", true), "GameBanana sound");

        // One file keeps its own name, not its folders.
        let single = audio_members(vec![("a/b/quake.wav".into(), vec![1])]);
        assert_eq!(single[0].0, "quake.wav");
        assert!(audio_members(vec![("a/readme.txt".into(), vec![1])]).is_empty());
    }

    #[test]
    fn gamebanana_sound_uploads_skip_unusable_files_and_refuse_when_none_work() {
        let (prepared, skipped, truncated) = prepare_sound_members(vec![
            ("good.wav".into(), pcm_wav(2205)),
            ("broken.wav".into(), b"RIFF not really".to_vec()),
            ("huge.wav".into(), vec![0; HITSOUND_MAX_BYTES + 1]),
        ])
        .unwrap();
        assert_eq!(prepared.len(), 1);
        assert_eq!(prepared[0].0, "good.wav");
        assert_eq!(skipped, 2);
        assert!(!truncated);

        assert!(prepare_sound_members(Vec::new())
            .unwrap_err()
            .message
            .contains("no WAV, MP3 or Ogg"));
        let err = prepare_sound_members(vec![("huge.wav".into(), vec![0; HITSOUND_MAX_BYTES + 1])])
            .unwrap_err();
        assert_eq!(err.message, HITSOUND_TOO_LARGE);

        let many = (0..GAMEBANANA_SOUNDS_MAX + 3)
            .map(|index| (format!("{index:02}.wav"), pcm_wav(64)))
            .collect();
        let (prepared, skipped, truncated) = prepare_sound_members(many).unwrap();
        assert_eq!(prepared.len(), GAMEBANANA_SOUNDS_MAX);
        assert_eq!(skipped, 0);
        assert!(truncated);
    }

    /// Downloads real uploads. Ignored so CI stays offline:
    /// `cargo test -p execs -- --ignored live_gamebanana_hit_sounds`.
    #[test]
    #[ignore]
    fn live_gamebanana_hit_sounds_prepare_from_their_archives() {
        use crate::gamebanana::{self, FileUse, GameBananaSection};
        // Quake III Arena hit indicator (RAR), Bubble Hitsound, a kill sound.
        for id in [21865, 19000, 37285] {
            let files =
                gamebanana::download_variants_in(GameBananaSection::Sound, id, FileUse::Sound)
                    .unwrap();
            let file = files.iter().find(|file| file.supported).unwrap();
            let pick =
                gamebanana::download_file_in(GameBananaSection::Sound, id, file.id, FileUse::Sound)
                    .unwrap();
            let bytes = gamebanana::download_pick(&pick).unwrap();
            let members = if gamebanana::is_audio_file(&pick.file_name) {
                vec![(pick.file_name.clone(), bytes)]
            } else {
                audio_members(
                    execs_core::archive::extract_archive(
                        &bytes,
                        execs_core::archive::ArchiveLimits::new(
                            20_000,
                            gamebanana::MOD_MAX_BYTES,
                            gamebanana::MOD_MAX_BYTES,
                        ),
                    )
                    .unwrap(),
                )
            };
            let (prepared, skipped, _) = prepare_sound_members(members).unwrap();
            println!(
                "{id} {}: {:?}, skipped {skipped}",
                pick.file_name,
                prepared.iter().map(|sound| &sound.0).collect::<Vec<_>>()
            );
            assert!(!prepared.is_empty());
        }
    }

    #[test]
    fn saved_catalog_sources_keep_their_wav_but_cannot_be_reencoded() {
        assert!(require_boostable_source(HitsoundSource::File).is_ok());
        // comfig.app sounds re-encode from the original upload again.
        assert!(require_boostable_source(HitsoundSource::Comfig).is_ok());
        let err = require_boostable_source(HitsoundSource::Community).unwrap_err();
        assert_eq!(err.code, "SourceUnavailable");
        assert!(err.message.contains("Keep its current boost"));
        // An invalid comfig id is refused before any network or cache read.
        assert!(pick_bytes(
            Path::new("unused"),
            "unused",
            &HitsoundPick::Comfig {
                hash: "../x".into(),
                name: "Bad".into(),
            },
        )
        .is_err());
        assert!(matches!(
            resolve_change(Path::new("unused"), "unused", HitsoundSlotChange::Keep),
            Ok(HitsoundChange::Keep)
        ));
    }
}
