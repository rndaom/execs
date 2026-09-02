//! Hit and kill sounds: a first-party pack at `tf/custom/execs-hitsounds/`.
//!
//! TF2 only ever plays the canonical `sound/ui/hitsound.wav` and
//! `sound/ui/killsound.wav` (the 2010 `wav_override` cvars are gone, and those
//! two names are what the engine exempts from sv_pure on Valve servers), so
//! the pack is exactly those two files. The engine accepts uncompressed
//! 8/16-bit PCM or 4-bit Microsoft ADPCM at 11025, 22050 or 44100 Hz and
//! nothing else — not MP3 renamed to `.wav`, not 48 kHz. Anything PCM we can
//! decode is converted to 16-bit 44.1 kHz on the way in; anything else is
//! refused with a reason.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::apply::{detail_from_manifest, write_owned_file_to, ProfileDetail, WriteOwnedOptions};
use crate::process_lock::{live_process_names, refuse_if_running_among};
use crate::profile::{
    exclusive_file_path, load_library_from, load_manifest, profiles_dir, remove_manifest_files_to,
    save_manifest, ProfileError,
};
use crate::vpk::read_vpk_dir_file_filtered;

pub const EXECS_HITSOUNDS_PACK: &str = "execs-hitsounds";
pub const HITSOUND_REL: &str = "tf/custom/execs-hitsounds/sound/ui/hitsound.wav";
pub const KILLSOUND_REL: &str = "tf/custom/execs-hitsounds/sound/ui/killsound.wav";

/// Ceiling on one sound file. A hit sound is a fraction of a second; even a
/// generous 44.1 kHz stereo 16-bit clip of ten seconds is under 2 MiB.
pub const HITSOUND_MAX_BYTES: usize = 8 * 1024 * 1024;

/// Sample rates the engine plays. Everything else is resampled to the last.
const SUPPORTED_RATES: [u32; 3] = [11025, 22050, 44100];
const TARGET_RATE: u32 = 44100;

const WAVE_FORMAT_PCM: u16 = 1;
const WAVE_FORMAT_ADPCM: u16 = 2;
const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HitsoundKind {
    Hit,
    Kill,
}

impl HitsoundKind {
    pub fn rel_path(self) -> &'static str {
        match self {
            Self::Hit => HITSOUND_REL,
            Self::Kill => KILLSOUND_REL,
        }
    }
}

/// Where an installed sound came from, so the pane can show its origin and
/// re-offer the right thing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HitsoundSource {
    /// A pinned community-pack entry; `name` is the upstream file stem.
    Community,
    /// A file the user picked; `name` is its original file name.
    File,
    /// comfig.app's hits library; `name` is the entry's display name.
    Comfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HitsoundEntry {
    pub name: String,
    pub source: HitsoundSource,
}

/// What the pack holds. `None` in a slot means the engine's own sound plays
/// (whichever `tf_dingalingaling_effect` picks).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HitsoundRecord {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hit: Option<HitsoundEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kill: Option<HitsoundEntry>,
}

/// What a WAV file is, read from its `fmt ` chunk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WavInfo {
    pub format_tag: u16,
    pub channels: u16,
    pub sample_rate: u32,
    pub bits_per_sample: u16,
    pub data_bytes: usize,
    pub duration_ms: u32,
}

struct Chunks<'a> {
    fmt: &'a [u8],
    data: &'a [u8],
}

fn read_u16(bytes: &[u8], at: usize) -> Option<u16> {
    bytes
        .get(at..at + 2)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
}

fn read_u32(bytes: &[u8], at: usize) -> Option<u32> {
    bytes
        .get(at..at + 4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

fn wav_chunks(bytes: &[u8]) -> Result<Chunks<'_>, String> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        if bytes.starts_with(b"ID3")
            || bytes.starts_with(&[0xFF, 0xFB])
            || bytes.starts_with(&[0xFF, 0xF3])
        {
            return Err("That is an MP3. TF2 only plays WAV hit sounds — convert it first.".into());
        }
        if bytes.starts_with(b"OggS") {
            return Err(
                "That is an Ogg file. TF2 only plays WAV hit sounds — convert it first.".into(),
            );
        }
        if bytes.starts_with(b"fLaC") {
            return Err(
                "That is a FLAC file. TF2 only plays WAV hit sounds — convert it first.".into(),
            );
        }
        return Err("That file is not a WAV.".into());
    }
    let mut fmt = None;
    let mut data = None;
    let mut at = 12usize;
    while at + 8 <= bytes.len() {
        let id = &bytes[at..at + 4];
        let len = read_u32(bytes, at + 4).ok_or("Truncated WAV chunk.")? as usize;
        let start = at + 8;
        let end = start.saturating_add(len).min(bytes.len());
        match id {
            b"fmt " => fmt = Some(&bytes[start..end]),
            b"data" => data = Some(&bytes[start..end]),
            _ => {}
        }
        // Chunks are word-aligned; a truncated final chunk still counts.
        at = start.saturating_add(len).saturating_add(len & 1);
        if fmt.is_some() && data.is_some() {
            break;
        }
    }
    let fmt = fmt.ok_or("That WAV has no format chunk.")?;
    let data = data.ok_or("That WAV has no audio data.")?;
    if fmt.len() < 16 {
        return Err("That WAV's format chunk is too short.".into());
    }
    Ok(Chunks { fmt, data })
}

/// The effective format tag: WAVE_FORMAT_EXTENSIBLE carries the real one in
/// the first two bytes of its sub-format GUID.
fn effective_tag(fmt: &[u8]) -> u16 {
    let tag = read_u16(fmt, 0).unwrap_or(0);
    if tag == WAVE_FORMAT_EXTENSIBLE {
        read_u16(fmt, 24).unwrap_or(tag)
    } else {
        tag
    }
}

/// Read the header of a WAV without decoding it. Fails on anything that is
/// not a RIFF/WAVE file with a format and a data chunk.
pub fn inspect_wav(bytes: &[u8]) -> Result<WavInfo, String> {
    let chunks = wav_chunks(bytes)?;
    let fmt = chunks.fmt;
    let format_tag = effective_tag(fmt);
    let channels = read_u16(fmt, 2).unwrap_or(0);
    let sample_rate = read_u32(fmt, 4).unwrap_or(0);
    let byte_rate = read_u32(fmt, 8).unwrap_or(0);
    let bits_per_sample = read_u16(fmt, 14).unwrap_or(0);
    if channels == 0 || sample_rate == 0 {
        return Err("That WAV has no channels or no sample rate.".into());
    }
    let data_bytes = chunks.data.len();
    // Byte rate is the honest way to time compressed data; fall back to the
    // PCM arithmetic when a writer left it zero.
    let bytes_per_second = if byte_rate > 0 {
        byte_rate as u64
    } else {
        u64::from(sample_rate) * u64::from(channels) * u64::from(bits_per_sample.max(8) / 8)
    };
    let duration_ms = (data_bytes as u64 * 1000)
        .checked_div(bytes_per_second)
        .unwrap_or(0)
        .min(u32::MAX as u64) as u32;
    Ok(WavInfo {
        format_tag,
        channels,
        sample_rate,
        bits_per_sample,
        data_bytes,
        duration_ms,
    })
}

/// Whether the engine plays this file as-is.
pub fn wav_is_engine_ready(info: &WavInfo) -> bool {
    let rate_ok = SUPPORTED_RATES.contains(&info.sample_rate);
    let format_ok = match info.format_tag {
        WAVE_FORMAT_PCM => matches!(info.bits_per_sample, 8 | 16),
        WAVE_FORMAT_ADPCM => true,
        _ => false,
    };
    rate_ok && format_ok && (1..=2).contains(&info.channels)
}

/// Bytes TF2 will play: the input verbatim when it already qualifies, or a
/// 16-bit 44.1 kHz PCM re-encode of any PCM/float WAV that does not. ADPCM
/// at an unsupported rate cannot be decoded here and is refused.
pub fn prepare_hitsound_wav(bytes: &[u8]) -> Result<(Vec<u8>, WavInfo), String> {
    if bytes.len() > HITSOUND_MAX_BYTES {
        return Err(format!(
            "That file is larger than the {} MB this app will accept for a hit sound.",
            HITSOUND_MAX_BYTES / (1024 * 1024)
        ));
    }
    let info = inspect_wav(bytes)?;
    if info.data_bytes == 0 {
        return Err("That WAV is empty.".into());
    }
    if wav_is_engine_ready(&info) {
        return Ok((bytes.to_vec(), info));
    }
    let converted = convert_to_pcm16(bytes, &info)?;
    let converted_info = inspect_wav(&converted)?;
    Ok((converted, converted_info))
}

fn convert_to_pcm16(bytes: &[u8], info: &WavInfo) -> Result<Vec<u8>, String> {
    let chunks = wav_chunks(bytes)?;
    let channels = usize::from(info.channels);
    let frames = decode_frames(chunks.data, info)?;
    if frames.is_empty() {
        return Err("That WAV is empty.".into());
    }
    // Keep mono as mono and fold anything wider than stereo down to stereo:
    // the engine's spatial-stereo prefix only knows one or two channels.
    let out_channels = channels.min(2);
    let mut folded: Vec<Vec<f32>> = (0..out_channels)
        .map(|_| Vec::with_capacity(frames.len()))
        .collect();
    for frame in &frames {
        for (channel, sink) in folded.iter_mut().enumerate() {
            sink.push(frame[channel]);
        }
    }
    let rate = if SUPPORTED_RATES.contains(&info.sample_rate) {
        info.sample_rate
    } else {
        TARGET_RATE
    };
    let resampled: Vec<Vec<f32>> = folded
        .into_iter()
        .map(|samples| resample_linear(&samples, info.sample_rate, rate))
        .collect();
    Ok(encode_pcm16(&resampled, rate))
}

/// Interleaved frames as f32 in [-1, 1], one Vec per frame.
fn decode_frames(data: &[u8], info: &WavInfo) -> Result<Vec<Vec<f32>>, String> {
    let channels = usize::from(info.channels);
    let bits = usize::from(info.bits_per_sample);
    let sample_bytes = bits / 8;
    if sample_bytes == 0 || bits % 8 != 0 {
        return Err(format!(
            "{}-bit samples are not something this app can convert.",
            info.bits_per_sample
        ));
    }
    let decode: fn(&[u8]) -> f32 = match (info.format_tag, bits) {
        (WAVE_FORMAT_PCM, 8) => |b| (f32::from(b[0]) - 128.0) / 128.0,
        (WAVE_FORMAT_PCM, 16) => |b| f32::from(i16::from_le_bytes([b[0], b[1]])) / 32768.0,
        (WAVE_FORMAT_PCM, 24) => |b| {
            let v = i32::from_le_bytes([0, b[0], b[1], b[2]]) >> 8;
            v as f32 / 8_388_608.0
        },
        (WAVE_FORMAT_PCM, 32) => |b| i32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f32 / 2_147_483_648.0,
        (WAVE_FORMAT_IEEE_FLOAT, 32) => |b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]),
        (WAVE_FORMAT_IEEE_FLOAT, 64) => |b| {
            f64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]]) as f32
        },
        (WAVE_FORMAT_ADPCM, _) => {
            return Err(format!(
                "That ADPCM WAV is {} Hz. TF2 needs 11025, 22050 or 44100 Hz — re-export it as PCM at 44100 Hz.",
                info.sample_rate
            ))
        }
        _ => {
            return Err(format!(
                "WAV format {} is not something this app can convert. Re-export it as 16-bit PCM at 44100 Hz.",
                info.format_tag
            ))
        }
    };
    let frame_bytes = sample_bytes * channels;
    let mut frames = Vec::with_capacity(data.len() / frame_bytes.max(1));
    for frame in data.chunks_exact(frame_bytes) {
        let mut samples = Vec::with_capacity(channels);
        for channel in 0..channels {
            let at = channel * sample_bytes;
            samples.push(decode(&frame[at..at + sample_bytes]).clamp(-1.0, 1.0));
        }
        frames.push(samples);
    }
    Ok(frames)
}

fn resample_linear(samples: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || samples.len() < 2 {
        return samples.to_vec();
    }
    let ratio = f64::from(from) / f64::from(to);
    let out_len = ((samples.len() as f64) / ratio).round().max(1.0) as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let position = i as f64 * ratio;
        let index = position.floor() as usize;
        let frac = (position - index as f64) as f32;
        let a = samples[index.min(samples.len() - 1)];
        let b = samples[(index + 1).min(samples.len() - 1)];
        out.push(a + (b - a) * frac);
    }
    out
}

fn encode_pcm16(channels: &[Vec<f32>], rate: u32) -> Vec<u8> {
    let channel_count = channels.len() as u16;
    let frames = channels.first().map(Vec::len).unwrap_or(0);
    let block_align = channel_count * 2;
    let data_len = (frames as u32) * u32::from(block_align);
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&WAVE_FORMAT_PCM.to_le_bytes());
    out.extend_from_slice(&channel_count.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * u32::from(block_align)).to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for frame in 0..frames {
        for channel in channels {
            let sample = (channel[frame].clamp(-1.0, 1.0) * 32767.0).round() as i16;
            out.extend_from_slice(&sample.to_le_bytes());
        }
    }
    out
}

// ---------------------------------------------------------------------------
// MS-ADPCM → PCM, for auditioning only
// ---------------------------------------------------------------------------

/// Microsoft ADPCM's fixed predictor coefficient table (7 pairs).
const ADPCM_COEFFS: [(i32, i32); 7] = [
    (256, 0),
    (512, -256),
    (0, 0),
    (192, 64),
    (240, 0),
    (460, -208),
    (392, -232),
];
const ADPCM_ADAPT: [i32; 16] = [
    230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230,
];

/// A copy of `bytes` the webview can play. The engine takes 4-bit MS-ADPCM
/// (every comfig.app sound is one) but browser audio elements do not, so
/// those are decoded to 16-bit PCM here; anything else passes through.
pub fn preview_wav(bytes: &[u8]) -> Vec<u8> {
    match inspect_wav(bytes) {
        Ok(info) if info.format_tag == WAVE_FORMAT_ADPCM => {
            decode_ms_adpcm(bytes, &info).unwrap_or_else(|_| bytes.to_vec())
        }
        _ => bytes.to_vec(),
    }
}

fn decode_ms_adpcm(bytes: &[u8], info: &WavInfo) -> Result<Vec<u8>, String> {
    let chunks = wav_chunks(bytes)?;
    let channels = usize::from(info.channels);
    if !(1..=2).contains(&channels) {
        return Err("Only mono and stereo ADPCM can be previewed.".into());
    }
    let block_align = usize::from(read_u16(chunks.fmt, 12).unwrap_or(0));
    if block_align < 7 * channels {
        return Err("That ADPCM WAV has an invalid block size.".into());
    }
    // Optional cbSize + samples-per-block; fall back to the MS default
    // derived from the block size when a writer left the extension out.
    let samples_per_block = read_u16(chunks.fmt, 18)
        .filter(|value| *value > 0)
        .map(usize::from)
        .unwrap_or((block_align - 7 * channels) * 2 / channels + 2);
    let mut out: Vec<Vec<f32>> = vec![Vec::new(); channels];
    for block in chunks.data.chunks(block_align) {
        if block.len() < 7 * channels {
            break;
        }
        let mut predictor = [0usize; 2];
        let mut delta = [0i32; 2];
        let mut sample1 = [0i32; 2];
        let mut sample2 = [0i32; 2];
        for ch in 0..channels {
            predictor[ch] = usize::from(block[ch]).min(ADPCM_COEFFS.len() - 1);
        }
        let mut at = channels;
        for slot in delta.iter_mut().take(channels) {
            *slot = i32::from(read_i16(block, at));
            at += 2;
        }
        for slot in sample1.iter_mut().take(channels) {
            *slot = i32::from(read_i16(block, at));
            at += 2;
        }
        for slot in sample2.iter_mut().take(channels) {
            *slot = i32::from(read_i16(block, at));
            at += 2;
        }
        // The two header samples come first, oldest first.
        for ch in 0..channels {
            out[ch].push(sample2[ch] as f32 / 32768.0);
            out[ch].push(sample1[ch] as f32 / 32768.0);
        }
        let mut produced = 2usize;
        let nibbles = block[at..].iter().flat_map(|byte| [byte >> 4, byte & 0x0F]);
        let mut ch = 0usize;
        for nibble in nibbles {
            if produced >= samples_per_block && ch == 0 {
                break;
            }
            let (c1, c2) = ADPCM_COEFFS[predictor[ch]];
            let predicted = (sample1[ch] * c1 + sample2[ch] * c2) >> 8;
            let signed = if nibble & 0x08 != 0 {
                i32::from(nibble) - 16
            } else {
                i32::from(nibble)
            };
            let sample = (predicted + signed * delta[ch]).clamp(-32768, 32767);
            out[ch].push(sample as f32 / 32768.0);
            sample2[ch] = sample1[ch];
            sample1[ch] = sample;
            delta[ch] = ((ADPCM_ADAPT[usize::from(nibble)] * delta[ch]) >> 8).max(16);
            ch += 1;
            if ch == channels {
                ch = 0;
                produced += 1;
            }
        }
    }
    if out[0].is_empty() {
        return Err("That ADPCM WAV holds no samples.".into());
    }
    Ok(encode_pcm16(&out, info.sample_rate))
}

fn read_i16(bytes: &[u8], at: usize) -> i16 {
    read_u16(bytes, at).map(|value| value as i16).unwrap_or(0)
}

/// One slot's intended state on apply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HitsoundChange {
    /// Leave whatever is installed alone.
    Keep,
    /// Remove the file so the engine's own sound plays.
    Clear,
    /// Install these (already engine-ready) bytes under this name.
    Install { entry: HitsoundEntry, wav: Vec<u8> },
}

pub fn apply_hitsounds(
    tf2_root: &Path,
    profile_id: &str,
    hit: HitsoundChange,
    kill: HitsoundChange,
) -> Result<ProfileDetail, ProfileError> {
    apply_hitsounds_to(
        &profiles_dir(),
        tf2_root,
        profile_id,
        hit,
        kill,
        live_process_names(),
    )
}

pub fn apply_hitsounds_to<I, S>(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    hit: HitsoundChange,
    kill: HitsoundChange,
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
    refuse_if_running_among(&running).map_err(ProfileError::from)?;
    let mut record = load_manifest(profiles_dir, profile_id)?
        .hitsound
        .unwrap_or_default();
    for (kind, change) in [(HitsoundKind::Hit, hit), (HitsoundKind::Kill, kill)] {
        match change {
            HitsoundChange::Keep => {}
            HitsoundChange::Clear => {
                remove_manifest_files_to(
                    profiles_dir,
                    tf2_root,
                    profile_id,
                    &[kind.rel_path().to_string()],
                    &running,
                )?;
                remove_live_file_if_active(profiles_dir, tf2_root, profile_id, kind.rel_path())?;
                set_slot(&mut record, kind, None);
            }
            HitsoundChange::Install { entry, wav } => {
                if wav.is_empty() || wav.len() > HITSOUND_MAX_BYTES {
                    return Err(ProfileError::Io(
                        "That sound file is empty or too large.".into(),
                    ));
                }
                let info = inspect_wav(&wav).map_err(ProfileError::Io)?;
                if !wav_is_engine_ready(&info) {
                    return Err(ProfileError::Io(
                        "That WAV is not in a format TF2 plays. Prepare it first.".into(),
                    ));
                }
                write_owned_file_to(
                    profiles_dir,
                    tf2_root,
                    profile_id,
                    kind.rel_path(),
                    &wav,
                    running.iter().cloned(),
                    WriteOwnedOptions::default(),
                )?;
                set_slot(&mut record, kind, Some(entry));
            }
        }
    }
    // The engine caches decoded sounds per folder; a stale cache plays the
    // previous file (or noise) after a same-name replace.
    remove_live_sound_cache_if_active(profiles_dir, tf2_root, profile_id)?;
    let mut manifest = load_manifest(profiles_dir, profile_id)?;
    manifest.hitsound = if record.hit.is_none() && record.kill.is_none() {
        None
    } else {
        Some(record)
    };
    save_manifest(profiles_dir, tf2_root, &manifest, &running)?;
    Ok(detail_from_manifest(&load_manifest(
        profiles_dir,
        profile_id,
    )?))
}

fn set_slot(record: &mut HitsoundRecord, kind: HitsoundKind, entry: Option<HitsoundEntry>) {
    match kind {
        HitsoundKind::Hit => record.hit = entry,
        HitsoundKind::Kill => record.kill = entry,
    }
}

pub fn remove_hitsounds(tf2_root: &Path, profile_id: &str) -> Result<ProfileDetail, ProfileError> {
    apply_hitsounds(
        tf2_root,
        profile_id,
        HitsoundChange::Clear,
        HitsoundChange::Clear,
    )
}

/// The installed bytes for one slot, straight from the profile's own copy.
pub fn stored_hitsound(
    profiles_dir: &Path,
    profile_id: &str,
    kind: HitsoundKind,
) -> Option<Vec<u8>> {
    let path = exclusive_file_path(profiles_dir, profile_id, kind.rel_path());
    let bytes = std::fs::read(path).ok()?;
    inspect_wav(&bytes).ok()?;
    Some(bytes)
}

fn remove_live_file_if_active(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    rel: &str,
) -> Result<(), ProfileError> {
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if library.active_profile_id.as_deref() != Some(profile_id) {
        return Ok(());
    }
    let mut dest = tf2_root.to_path_buf();
    for part in rel.split('/') {
        dest.push(part);
    }
    if dest.is_file() {
        std::fs::remove_file(&dest).map_err(|err| ProfileError::Io(err.to_string()))?;
    }
    // Leave the folder itself for the engine to ignore when empty; removing
    // the whole pack is the caller's decision, not a side effect of one slot.
    Ok(())
}

fn remove_live_sound_cache_if_active(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
) -> Result<(), ProfileError> {
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if library.active_profile_id.as_deref() != Some(profile_id) {
        return Ok(());
    }
    let cache = tf2_root
        .join("tf")
        .join("custom")
        .join(EXECS_HITSOUNDS_PACK)
        .join("sound")
        .join("sound.cache");
    if cache.is_file() {
        std::fs::remove_file(&cache).map_err(|err| ProfileError::Io(err.to_string()))?;
    }
    Ok(())
}

/// The stock hit and kill sounds, read from the user's own
/// `tf2_sound_misc_dir.vpk`, keyed by file stem (`hitsound_electro1`,
/// `killsound_vortex`, …). Lets the pane preview every built-in effect
/// without shipping a byte of Valve audio.
pub fn extract_stock_hitsounds(tf2_root: &Path) -> Result<BTreeMap<String, Vec<u8>>, ProfileError> {
    let vpk = tf2_root.join("tf").join("tf2_sound_misc_dir.vpk");
    if !vpk.is_file() {
        return Err(ProfileError::Io(
            "Could not find tf/tf2_sound_misc_dir.vpk. Confirm the TF2 install.".into(),
        ));
    }
    let keep = |rel: &str| {
        let lower = rel.to_ascii_lowercase();
        lower.starts_with("sound/ui/")
            && (lower.contains("/hitsound") || lower.contains("/killsound"))
            && lower.ends_with(".wav")
    };
    let archive =
        read_vpk_dir_file_filtered(&vpk, &keep).map_err(|err| ProfileError::Io(err.message()))?;
    let mut out = BTreeMap::new();
    for (path, bytes) in archive.files {
        let stem = path
            .rsplit('/')
            .next()
            .unwrap_or(&path)
            .trim_end_matches(".wav")
            .to_ascii_lowercase();
        if inspect_wav(&bytes).is_ok() {
            out.insert(stem, bytes);
        }
    }
    if out.is_empty() {
        return Err(ProfileError::Io(
            "No hit sounds were found in the local TF2 VPK.".into(),
        ));
    }
    Ok(out)
}

/// The nine built-in effects `tf_dingalingaling_effect` /
/// `tf_dingalingaling_last_effect` index into, with the stock file each one
/// plays first (index 0 reads the customizable file).
pub const STOCK_HITSOUND_EFFECTS: [(&str, &str, &str); 9] = [
    ("Default", "hitsound", "killsound"),
    ("Electro", "hitsound_electro1", "killsound_electro"),
    ("Notes", "hitsound_menu_note1", "killsound_note"),
    ("Percussion", "hitsound_percussion1", "killsound_percussion"),
    ("Retro", "hitsound_retro1", "killsound_retro"),
    ("Space", "hitsound_space", "killsound_space"),
    ("Beepo", "hitsound_beepo", "killsound_beepo"),
    ("Vortex", "hitsound_vortex1", "killsound_vortex"),
    ("Squasher", "hitsound_squasher", "killsound_squasher"),
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::{create_profile_record_to, set_active_profile_to};
    use crate::test_temp_dir;
    use crate::vpk::write_vpk_v1;

    fn pcm_wav(rate: u32, channels: u16, bits: u16, frames: usize) -> Vec<u8> {
        let block = channels * bits / 8;
        let data_len = frames as u32 * u32::from(block);
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data_len).to_le_bytes());
        out.extend_from_slice(b"WAVE");
        out.extend_from_slice(b"fmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&WAVE_FORMAT_PCM.to_le_bytes());
        out.extend_from_slice(&channels.to_le_bytes());
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * u32::from(block)).to_le_bytes());
        out.extend_from_slice(&block.to_le_bytes());
        out.extend_from_slice(&bits.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&data_len.to_le_bytes());
        for frame in 0..frames {
            for _ in 0..channels {
                // A slow ramp so resampling has something to interpolate.
                let value = ((frame % 100) as f32 / 100.0) * 2.0 - 1.0;
                match bits {
                    8 => out.push(((value * 127.0) + 128.0) as u8),
                    16 => out.extend_from_slice(&((value * 32767.0) as i16).to_le_bytes()),
                    24 => {
                        let v = (value * 8_388_607.0) as i32;
                        out.extend_from_slice(&v.to_le_bytes()[0..3]);
                    }
                    _ => out.extend_from_slice(&((value * 2_147_483_647.0) as i32).to_le_bytes()),
                }
            }
        }
        out
    }

    fn setup() -> (
        std::path::PathBuf,
        std::path::PathBuf,
        std::path::PathBuf,
        String,
    ) {
        let root = test_temp_dir();
        let tf2 = root.join("tf2");
        std::fs::create_dir_all(tf2.join("tf/cfg")).unwrap();
        std::fs::create_dir_all(tf2.join("tf/custom")).unwrap();
        std::fs::write(tf2.join("tf/steam.inf"), "appID=440\n").unwrap();
        let profiles = root.join("profiles");
        create_profile_record_to(&profiles, &tf2, "Main", Vec::<String>::new()).unwrap();
        let id = crate::profile::load_library_from(&profiles, Some(&tf2))
            .unwrap()
            .profiles[0]
            .id
            .clone();
        set_active_profile_to(&profiles, &tf2, &id, Vec::<String>::new()).unwrap();
        (root, profiles, tf2, id)
    }

    fn unlocked() -> Vec<String> {
        Vec::new()
    }

    #[test]
    fn a_stock_style_wav_passes_through_untouched() {
        let wav = pcm_wav(44100, 2, 16, 4410);
        let (out, info) = prepare_hitsound_wav(&wav).unwrap();
        assert_eq!(out, wav);
        assert_eq!(info.sample_rate, 44100);
        assert_eq!(info.channels, 2);
        assert_eq!(info.duration_ms, 100);
        assert!(wav_is_engine_ready(&info));
        assert!(wav_is_engine_ready(
            &inspect_wav(&pcm_wav(22050, 1, 8, 100)).unwrap()
        ));
    }

    #[test]
    fn an_unsupported_rate_or_depth_is_converted_to_16_bit_44100() {
        let wav = pcm_wav(48000, 2, 24, 4800);
        let (out, info) = prepare_hitsound_wav(&wav).unwrap();
        assert_ne!(out, wav);
        assert_eq!(info.sample_rate, 44100);
        assert_eq!(info.bits_per_sample, 16);
        assert_eq!(info.format_tag, WAVE_FORMAT_PCM);
        assert_eq!(info.channels, 2);
        assert!(wav_is_engine_ready(&info));
        // 4800 frames at 48 kHz is 100 ms; so is the result at 44.1 kHz.
        assert!((info.duration_ms as i64 - 100).abs() <= 1);

        let wide = pcm_wav(44100, 6, 32, 441);
        let (_, folded) = prepare_hitsound_wav(&wide).unwrap();
        assert_eq!(folded.channels, 2, "surround folds down to stereo");
        assert!(wav_is_engine_ready(&folded));

        let deep = pcm_wav(32728, 1, 16, 3272);
        let (_, fixed) = prepare_hitsound_wav(&deep).unwrap();
        assert_eq!(fixed.sample_rate, 44100);
    }

    #[test]
    fn non_wav_files_are_refused_with_their_kind_named() {
        let err = prepare_hitsound_wav(b"ID3\x03\x00\x00\x00\x00\x00\x00").unwrap_err();
        assert!(err.contains("MP3"), "{err}");
        let err = prepare_hitsound_wav(b"OggS\x00\x02").unwrap_err();
        assert!(err.contains("Ogg"), "{err}");
        let err = prepare_hitsound_wav(b"not audio at all").unwrap_err();
        assert!(err.contains("not a WAV"), "{err}");
        let mut headless = pcm_wav(44100, 1, 16, 10);
        // Corrupt the fmt id so no format chunk is found.
        headless[12..16].copy_from_slice(b"junk");
        assert!(prepare_hitsound_wav(&headless)
            .unwrap_err()
            .contains("no format chunk"));
    }

    #[test]
    fn apply_writes_both_files_records_them_and_clears_them_again() {
        let (root, profiles, tf2, id) = setup();
        let wav = pcm_wav(44100, 2, 16, 441);
        let detail = apply_hitsounds_to(
            &profiles,
            &tf2,
            &id,
            HitsoundChange::Install {
                entry: HitsoundEntry {
                    name: "quack".into(),
                    source: HitsoundSource::Community,
                },
                wav: wav.clone(),
            },
            HitsoundChange::Install {
                entry: HitsoundEntry {
                    name: "my kill.wav".into(),
                    source: HitsoundSource::File,
                },
                wav: wav.clone(),
            },
            unlocked(),
        )
        .unwrap();
        let record = detail.hitsound.clone().unwrap();
        assert_eq!(record.hit.unwrap().name, "quack");
        assert_eq!(record.kill.unwrap().source, HitsoundSource::File);
        assert_eq!(std::fs::read(tf2.join(HITSOUND_REL)).unwrap(), wav);
        assert_eq!(std::fs::read(tf2.join(KILLSOUND_REL)).unwrap(), wav);
        assert_eq!(
            stored_hitsound(&profiles, &id, HitsoundKind::Hit).unwrap(),
            wav
        );

        // A stale engine cache next to the files goes with the next apply.
        let cache = tf2.join("tf/custom/execs-hitsounds/sound/sound.cache");
        std::fs::write(&cache, b"stale").unwrap();
        let detail = apply_hitsounds_to(
            &profiles,
            &tf2,
            &id,
            HitsoundChange::Keep,
            HitsoundChange::Clear,
            unlocked(),
        )
        .unwrap();
        assert!(!cache.exists());
        assert!(tf2.join(HITSOUND_REL).is_file());
        assert!(!tf2.join(KILLSOUND_REL).exists());
        let record = detail.hitsound.clone().unwrap();
        assert!(record.hit.is_some());
        assert!(record.kill.is_none());
        assert!(stored_hitsound(&profiles, &id, HitsoundKind::Kill).is_none());

        let detail = remove_hitsounds_to_for_test(&profiles, &tf2, &id);
        assert!(detail.hitsound.is_none());
        assert!(!tf2.join(HITSOUND_REL).exists());
        assert!(load_manifest(&profiles, &id)
            .unwrap()
            .files
            .iter()
            .all(|file| !file.path.contains("execs-hitsounds")));
        let _ = std::fs::remove_dir_all(root);
    }

    fn remove_hitsounds_to_for_test(profiles: &Path, tf2: &Path, id: &str) -> ProfileDetail {
        apply_hitsounds_to(
            profiles,
            tf2,
            id,
            HitsoundChange::Clear,
            HitsoundChange::Clear,
            unlocked(),
        )
        .unwrap()
    }

    #[test]
    fn apply_refuses_unprepared_audio_and_a_running_game() {
        let (root, profiles, tf2, id) = setup();
        let bad = pcm_wav(48000, 2, 16, 480);
        let err = apply_hitsounds_to(
            &profiles,
            &tf2,
            &id,
            HitsoundChange::Install {
                entry: HitsoundEntry {
                    name: "x".into(),
                    source: HitsoundSource::File,
                },
                wav: bad,
            },
            HitsoundChange::Keep,
            unlocked(),
        )
        .unwrap_err();
        assert!(
            err.message().contains("Prepare it first"),
            "{}",
            err.message()
        );

        let locked = vec![if cfg!(windows) {
            "tf_win64.exe".to_string()
        } else {
            "tf_linux64".to_string()
        }];
        let err = apply_hitsounds_to(
            &profiles,
            &tf2,
            &id,
            HitsoundChange::Clear,
            HitsoundChange::Clear,
            locked,
        )
        .unwrap_err();
        assert!(matches!(err, ProfileError::GameRunning));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn stock_sounds_come_out_of_a_synthetic_sound_vpk_by_stem() {
        let root = test_temp_dir();
        let tf2 = root.join("tf2");
        std::fs::create_dir_all(tf2.join("tf")).unwrap();
        let mut files = BTreeMap::new();
        files.insert(
            "sound/ui/hitsound.wav".to_string(),
            pcm_wav(44100, 2, 16, 44),
        );
        files.insert(
            "sound/ui/hitsound_electro1.wav".to_string(),
            pcm_wav(44100, 2, 16, 44),
        );
        files.insert(
            "sound/ui/killsound_vortex.wav".to_string(),
            pcm_wav(44100, 2, 16, 44),
        );
        files.insert(
            "sound/ui/buttonclick.wav".to_string(),
            pcm_wav(44100, 1, 16, 44),
        );
        files.insert("sound/ui/hitsound_broken.wav".to_string(), b"nope".to_vec());
        std::fs::write(tf2.join("tf/tf2_sound_misc_dir.vpk"), write_vpk_v1(&files)).unwrap();
        let stock = extract_stock_hitsounds(&tf2).unwrap();
        assert_eq!(
            stock.keys().cloned().collect::<Vec<_>>(),
            vec!["hitsound", "hitsound_electro1", "killsound_vortex"]
        );
        let _ = std::fs::remove_dir_all(root);
    }

    fn adpcm_wav(channels: u16, blocks: usize, nibble: u8) -> Vec<u8> {
        let block_align: u16 = 7 * channels + 8 * channels;
        let samples_per_block: u16 = 2 + 16;
        let mut fmt = Vec::new();
        fmt.extend_from_slice(&WAVE_FORMAT_ADPCM.to_le_bytes());
        fmt.extend_from_slice(&channels.to_le_bytes());
        fmt.extend_from_slice(&44100u32.to_le_bytes());
        fmt.extend_from_slice(&0u32.to_le_bytes());
        fmt.extend_from_slice(&block_align.to_le_bytes());
        fmt.extend_from_slice(&4u16.to_le_bytes());
        fmt.extend_from_slice(&2u16.to_le_bytes());
        fmt.extend_from_slice(&samples_per_block.to_le_bytes());
        let mut data = Vec::new();
        for _ in 0..blocks {
            // predictor 0: coef (256, 0) → predicted = sample1
            data.resize(data.len() + usize::from(channels), 0u8);
            for _ in 0..channels {
                data.extend_from_slice(&16i16.to_le_bytes()); // delta
            }
            for _ in 0..channels {
                data.extend_from_slice(&1000i16.to_le_bytes()); // sample1
            }
            for _ in 0..channels {
                data.extend_from_slice(&500i16.to_le_bytes()); // sample2
            }
            for _ in 0..8 * channels {
                data.push(nibble << 4 | nibble);
            }
        }
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&((4 + 8 + fmt.len() + 8 + data.len()) as u32).to_le_bytes());
        out.extend_from_slice(b"WAVE");
        out.extend_from_slice(b"fmt ");
        out.extend_from_slice(&(fmt.len() as u32).to_le_bytes());
        out.extend_from_slice(&fmt);
        out.extend_from_slice(b"data");
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&data);
        out
    }

    #[test]
    fn adpcm_installs_verbatim_but_previews_as_pcm() {
        let wav = adpcm_wav(2, 3, 0);
        let (installed, info) = prepare_hitsound_wav(&wav).unwrap();
        assert_eq!(installed, wav, "the engine plays ADPCM as-is");
        assert_eq!(info.format_tag, WAVE_FORMAT_ADPCM);

        let preview = preview_wav(&wav);
        let decoded = inspect_wav(&preview).unwrap();
        assert_eq!(decoded.format_tag, WAVE_FORMAT_PCM);
        assert_eq!(decoded.bits_per_sample, 16);
        assert_eq!(decoded.channels, 2);
        assert_eq!(decoded.sample_rate, 44100);
        // 3 blocks × 18 samples × 2 channels × 2 bytes.
        assert_eq!(decoded.data_bytes, 3 * 18 * 2 * 2);
        // Predictor 0 with zero nibbles repeats sample1 after the two header
        // samples: 500, 1000, 1000, 1000, …
        let data_at = preview.len() - decoded.data_bytes;
        let sample = |index: usize| {
            i16::from_le_bytes([
                preview[data_at + index * 2],
                preview[data_at + index * 2 + 1],
            ])
        };
        assert_eq!(sample(0), 500);
        assert_eq!(sample(1), 500);
        assert_eq!(sample(2), 1000);
        assert_eq!(sample(3), 1000);
        assert_eq!(sample(4), 1000);
        assert_eq!(sample(6), 1000);

        // A positive nibble climbs by delta: 1000 + 1*16, then delta adapts.
        let climbing = preview_wav(&adpcm_wav(1, 1, 1));
        let climbing_info = inspect_wav(&climbing).unwrap();
        let at = climbing.len() - climbing_info.data_bytes;
        let s = |index: usize| {
            i16::from_le_bytes([climbing[at + index * 2], climbing[at + index * 2 + 1]])
        };
        assert_eq!(s(2), 1016);
        assert!(s(3) > s(2));

        // PCM passes through untouched; garbage and truncation never panic.
        let pcm = pcm_wav(44100, 1, 16, 10);
        assert_eq!(preview_wav(&pcm), pcm);
        assert_eq!(preview_wav(b"nope"), b"nope".to_vec());
        let _ = preview_wav(&wav[..40]);
    }

    #[test]
    fn every_stock_effect_names_a_hit_and_a_kill_file() {
        assert_eq!(STOCK_HITSOUND_EFFECTS.len(), 9);
        for (label, hit, kill) in STOCK_HITSOUND_EFFECTS {
            assert!(!label.is_empty());
            assert!(hit.starts_with("hitsound"), "{hit}");
            assert!(kill.starts_with("killsound"), "{kill}");
        }
    }

    #[test]
    fn pack_paths_stay_file_safe() {
        assert!(crate::apply::is_file_safe_rel_path(HITSOUND_REL));
        assert!(crate::apply::is_file_safe_rel_path(KILLSOUND_REL));
    }
}
