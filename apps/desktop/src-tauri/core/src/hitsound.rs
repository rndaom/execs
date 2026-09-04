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

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::apply::{detail_from_manifest, ProfileDetail};
use crate::archive::read_regular_file_bounded_within;
use crate::hash::{metadata_is_link, remove_file_force_within, validate_dir_within};
use crate::process_lock::{live_process_names, refuse_if_running_among};
use crate::profile::{
    exclusive_file_path, load_library_from, load_manifest, mutate_profile_files_to, profiles_dir,
    FileSource, ProfileError, ProfileLiveProjection, ProfileManifest,
};
use crate::vpk::read_vpk_dir_file_filtered;

pub const EXECS_HITSOUNDS_PACK: &str = "execs-hitsounds";
pub const HITSOUND_REL: &str = "tf/custom/execs-hitsounds/sound/ui/hitsound.wav";
pub const KILLSOUND_REL: &str = "tf/custom/execs-hitsounds/sound/ui/killsound.wav";

/// Ceiling on one sound file. A hit sound is a fraction of a second; even a
/// generous 44.1 kHz stereo 16-bit clip of ten seconds is under 2 MiB.
pub const HITSOUND_MAX_BYTES: usize = 8 * 1024 * 1024;
const MAX_LIVE_HITSOUND_ENTRIES: usize = 128;
const MAX_HITSOUND_ENTRY_NAME_BYTES: usize = 256;
const MAX_HITSOUND_SOURCE_ID_BYTES: usize = 256;

/// Sample rates the engine plays. Everything else is resampled to the last.
const SUPPORTED_RATES: [u32; 3] = [11025, 22050, 44100];
const TARGET_RATE: u32 = 44100;

/// The band of header sample rates this app believes. Real audio lives in
/// 8–192 kHz; a header claiming 8 Hz is a corrupt or hostile file, and the
/// resampler would try to expand it by thousands of times (an 8 MB file at
/// "8 Hz" asks for tens of gigabytes and aborts the process).
const MIN_SAMPLE_RATE: u32 = 8_000;
const MAX_SAMPLE_RATE: u32 = 192_000;

/// Longest clip this app converts. A hit sound is a fraction of a second;
/// 30 s of stereo 16-bit 44.1 kHz is 5.3 MB, inside [`HITSOUND_MAX_BYTES`],
/// so nothing that auditions is refused later at apply.
const MAX_HITSOUND_SECONDS: u64 = 30;

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
    /// Gain applied to the file itself, in dB (0, 6 or 12). The engine caps
    /// `tf_dingaling_volume` at 1, so a quiet file can only get louder here.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub boost: u8,
    /// The picked-file stash token, kept so the boost can be changed later
    /// without asking for the file again.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    /// comfig.app entry hash, kept for the same reason.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
}

fn is_zero(value: &u8) -> bool {
    *value == 0
}

impl HitsoundEntry {
    pub fn new(name: String, source: HitsoundSource) -> Self {
        Self {
            name,
            source,
            boost: 0,
            token: None,
            hash: None,
        }
    }
}

/// The boost steps the pane offers. Anything else snaps to the nearest one.
pub const BOOST_STEPS_DB: [u8; 3] = [0, 6, 12];

pub fn clamp_boost_db(db: u8) -> u8 {
    BOOST_STEPS_DB
        .iter()
        .copied()
        .min_by_key(|step| step.abs_diff(db))
        .unwrap_or(0)
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
    /// The effective format: WAVE_FORMAT_EXTENSIBLE unwrapped to its
    /// sub-format, so the decoders know what the samples are.
    pub format_tag: u16,
    /// The tag as written in the file. The Source mixer dispatches on this
    /// one and knows only PCM and MS-ADPCM, so an extensible-wrapped PCM file
    /// (`format_tag` 1, `raw_format_tag` 0xFFFE) plays nothing until it is
    /// rewritten with a plain header.
    #[serde(skip)]
    pub raw_format_tag: u16,
    pub channels: u16,
    pub sample_rate: u32,
    pub bits_per_sample: u16,
    pub data_bytes: usize,
    pub duration_ms: u32,
    #[serde(skip)]
    block_align: u16,
    #[serde(skip)]
    byte_rate: u32,
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
        let end = start
            .checked_add(len)
            .ok_or("WAV chunk length overflowed.")?;
        if end > bytes.len() {
            return Err("That WAV has a truncated chunk.".into());
        }
        match id {
            b"fmt " => fmt = Some(&bytes[start..end]),
            b"data" => data = Some(&bytes[start..end]),
            _ => {}
        }
        // Chunks are word-aligned.
        at = end
            .checked_add(len & 1)
            .ok_or("WAV chunk offset overflowed.")?;
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

#[derive(Debug)]
struct AdpcmLayout {
    block_align: usize,
    samples_per_block: usize,
    coefficients: Vec<(i32, i32)>,
}

fn ms_adpcm_layout(
    fmt: &[u8],
    data: &[u8],
    channels: u16,
    bits_per_sample: u16,
) -> Result<AdpcmLayout, String> {
    if bits_per_sample != 4 {
        return Err("That MS-ADPCM WAV is not 4-bit audio.".into());
    }
    if !(1..=2).contains(&channels) {
        return Err("Only mono and stereo MS-ADPCM hit sounds are supported.".into());
    }
    if fmt.len() < 22 {
        return Err("That MS-ADPCM WAV has no complete format extension.".into());
    }
    let extension_size = usize::from(read_u16(fmt, 16).unwrap_or(0));
    let extension_end = 18usize
        .checked_add(extension_size)
        .ok_or("MS-ADPCM format extension overflowed.")?;
    if extension_size < 4 || extension_end > fmt.len() {
        return Err("That MS-ADPCM WAV has a truncated format extension.".into());
    }
    let samples_per_block = usize::from(read_u16(fmt, 18).unwrap_or(0));
    let coefficient_count = usize::from(read_u16(fmt, 20).unwrap_or(0));
    if coefficient_count == 0 || coefficient_count > 256 {
        return Err("That MS-ADPCM WAV has an invalid coefficient count.".into());
    }
    let coefficient_bytes = coefficient_count
        .checked_mul(4)
        .ok_or("MS-ADPCM coefficient table overflowed.")?;
    let coefficient_end = 22usize
        .checked_add(coefficient_bytes)
        .ok_or("MS-ADPCM coefficient table overflowed.")?;
    if coefficient_end > extension_end || coefficient_end > fmt.len() {
        return Err("That MS-ADPCM WAV has a truncated coefficient table.".into());
    }
    let mut coefficients = Vec::with_capacity(coefficient_count);
    for index in 0..coefficient_count {
        let at = 22 + index * 4;
        coefficients.push((
            i32::from(read_i16(fmt, at)),
            i32::from(read_i16(fmt, at + 2)),
        ));
    }

    let channels = usize::from(channels);
    let block_align = usize::from(read_u16(fmt, 12).unwrap_or(0));
    let header_bytes = 7usize
        .checked_mul(channels)
        .ok_or("MS-ADPCM block header overflowed.")?;
    if block_align < header_bytes {
        return Err("That MS-ADPCM WAV has an invalid block size.".into());
    }
    let payload_nibbles = (block_align - header_bytes)
        .checked_mul(2)
        .ok_or("MS-ADPCM block size overflowed.")?;
    if !payload_nibbles.is_multiple_of(channels) {
        return Err("That MS-ADPCM WAV has a misaligned block size.".into());
    }
    let expected_samples_per_block = 2 + payload_nibbles / channels;
    if samples_per_block != expected_samples_per_block {
        return Err("That MS-ADPCM WAV has an inconsistent samples-per-block value.".into());
    }
    if !data.len().is_multiple_of(block_align) {
        return Err("That MS-ADPCM WAV ends with an incomplete audio block.".into());
    }
    for block in data.chunks_exact(block_align) {
        if block[..channels]
            .iter()
            .any(|predictor| usize::from(*predictor) >= coefficient_count)
        {
            return Err("That MS-ADPCM WAV uses an invalid predictor.".into());
        }
    }
    Ok(AdpcmLayout {
        block_align,
        samples_per_block,
        coefficients,
    })
}

/// Read the header of a WAV without decoding it. Fails on anything that is
/// not a RIFF/WAVE file with a format and a data chunk.
pub fn inspect_wav(bytes: &[u8]) -> Result<WavInfo, String> {
    let chunks = wav_chunks(bytes)?;
    let fmt = chunks.fmt;
    let raw_format_tag = read_u16(fmt, 0).unwrap_or(0);
    let format_tag = effective_tag(fmt);
    let channels = read_u16(fmt, 2).unwrap_or(0);
    let sample_rate = read_u32(fmt, 4).unwrap_or(0);
    let byte_rate = read_u32(fmt, 8).unwrap_or(0);
    let block_align = read_u16(fmt, 12).unwrap_or(0);
    let bits_per_sample = read_u16(fmt, 14).unwrap_or(0);
    if channels == 0 || sample_rate == 0 {
        return Err("That WAV has no channels or no sample rate.".into());
    }
    if !(MIN_SAMPLE_RATE..=MAX_SAMPLE_RATE).contains(&sample_rate) {
        return Err(format!(
            "That WAV's header says {sample_rate} Hz. This app accepts {MIN_SAMPLE_RATE} to {MAX_SAMPLE_RATE} Hz — re-export it at 44100 Hz."
        ));
    }
    // Some widely-used TF2/comfig MS-ADPCM assets carry a placeholder
    // nAvgBytesPerSec even though their block structure is valid and TF2
    // plays them. Treat the complete block layout as authoritative instead
    // of rejecting or timing compressed audio from that unreliable field.
    let adpcm_layout = if raw_format_tag == WAVE_FORMAT_ADPCM {
        Some(ms_adpcm_layout(
            fmt,
            chunks.data,
            channels,
            bits_per_sample,
        )?)
    } else {
        None
    };
    let data_bytes = chunks.data.len();
    let duration_ms = if let Some(layout) = adpcm_layout {
        let blocks = u64::try_from(data_bytes / layout.block_align)
            .map_err(|_| "MS-ADPCM block count overflowed.")?;
        let samples_per_block = u64::try_from(layout.samples_per_block)
            .map_err(|_| "MS-ADPCM sample count overflowed.")?;
        blocks
            .checked_mul(samples_per_block)
            .and_then(|samples| samples.checked_mul(1000))
            .and_then(|millis| millis.checked_div(u64::from(sample_rate)))
            .unwrap_or(0)
            .min(u64::from(u32::MAX)) as u32
    } else {
        // Byte rate is useful for the remaining compressed formats; fall
        // back to PCM arithmetic when a writer left it zero.
        let bytes_per_second = if byte_rate > 0 {
            u64::from(byte_rate)
        } else {
            u64::from(sample_rate) * u64::from(channels) * u64::from(bits_per_sample.max(8) / 8)
        };
        u64::try_from(data_bytes)
            .ok()
            .and_then(|bytes| bytes.checked_mul(1000))
            .and_then(|millis| millis.checked_div(bytes_per_second))
            .unwrap_or(0)
            .min(u64::from(u32::MAX)) as u32
    };
    Ok(WavInfo {
        format_tag,
        raw_format_tag,
        channels,
        sample_rate,
        bits_per_sample,
        data_bytes,
        duration_ms,
        block_align,
        byte_rate,
    })
}

/// Whether the engine plays this file as-is. The raw tag must be plain PCM
/// or MS-ADPCM: the mixer never unwraps WAVE_FORMAT_EXTENSIBLE, so such a
/// file has to be rewritten even when its samples already qualify.
pub fn wav_is_engine_ready(info: &WavInfo) -> bool {
    let rate_ok = SUPPORTED_RATES.contains(&info.sample_rate);
    let format_ok = match info.raw_format_tag {
        WAVE_FORMAT_PCM if matches!(info.bits_per_sample, 8 | 16) => {
            let bytes_per_sample = info.bits_per_sample / 8;
            let expected_align = info.channels.checked_mul(bytes_per_sample);
            expected_align.is_some_and(|align| {
                align > 0
                    && info.block_align == align
                    && info.byte_rate == info.sample_rate.checked_mul(u32::from(align)).unwrap_or(0)
                    && info.data_bytes.is_multiple_of(usize::from(align))
            })
        }
        // `inspect_wav` validates the complete MS-ADPCM extension, block
        // layout, coefficient table and data before constructing `WavInfo`.
        WAVE_FORMAT_ADPCM => info.bits_per_sample == 4,
        _ => false,
    };
    rate_ok && format_ok && (1..=2).contains(&info.channels)
}

/// Bytes TF2 will play: the input's own samples under a clean header when it
/// already qualifies, or a 16-bit 44.1 kHz PCM re-encode of any PCM/float WAV
/// that does not. ADPCM at an unsupported rate cannot be decoded here and is
/// refused.
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
        let chunks = wav_chunks(bytes)?;
        let clean = rebuild_wav(chunks.fmt, chunks.data);
        let clean_info = inspect_wav(&clean)?;
        return Ok((clean, clean_info));
    }
    let converted = convert_to_pcm16(bytes, &info, 1.0)?;
    let converted_info = inspect_wav(&converted)?;
    Ok((converted, converted_info))
}

/// `RIFF` / `fmt ` / `data` and nothing else, the sample bytes untouched.
/// Editors leave `cue `, `smpl` and `LIST` chunks behind, and the engine
/// reads a cue point as a loop start — the classic "my hit sound repeats"
/// report — so an installed file never carries anything but those two
/// chunks. A file that was already just those two comes out byte-identical.
fn rebuild_wav(fmt: &[u8], data: &[u8]) -> Vec<u8> {
    let fmt_pad = fmt.len() & 1;
    let data_pad = data.len() & 1;
    let riff_len = 4 + 8 + fmt.len() + fmt_pad + 8 + data.len() + data_pad;
    let mut out = Vec::with_capacity(8 + riff_len);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(riff_len as u32).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&(fmt.len() as u32).to_le_bytes());
    out.extend_from_slice(fmt);
    out.resize(out.len() + fmt_pad, 0);
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(data);
    out.resize(out.len() + data_pad, 0);
    out
}

/// Like [`prepare_hitsound_wav`], then louder by `boost_db` with a soft
/// clip, re-encoded as 16-bit PCM. ADPCM input is decoded first. A boost of 0
/// is exactly [`prepare_hitsound_wav`].
pub fn prepare_hitsound_wav_boosted(
    bytes: &[u8],
    boost_db: u8,
) -> Result<(Vec<u8>, WavInfo), String> {
    let boost_db = clamp_boost_db(boost_db);
    if boost_db == 0 {
        return prepare_hitsound_wav(bytes);
    }
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
    let gain = 10f32.powf(f32::from(boost_db) / 20.0);
    let pcm = if info.format_tag == WAVE_FORMAT_ADPCM {
        decode_ms_adpcm(bytes, &info)?
    } else {
        bytes.to_vec()
    };
    let pcm_info = inspect_wav(&pcm)?;
    let converted = convert_to_pcm16(&pcm, &pcm_info, gain)?;
    let converted_info = inspect_wav(&converted)?;
    Ok((converted, converted_info))
}

/// `gain` above 1 pushes the signal into a soft clip (tanh), so a boost gets
/// loud without the crackle a hard clip would add.
fn convert_to_pcm16(bytes: &[u8], info: &WavInfo, gain: f32) -> Result<Vec<u8>, String> {
    let chunks = wav_chunks(bytes)?;
    let channels = usize::from(info.channels);
    let mut samples = decode_frames(chunks.data, info)?;
    if samples.is_empty() {
        return Err("That WAV is empty.".into());
    }
    if gain > 1.0 {
        for sample in &mut samples {
            *sample = (*sample * gain).tanh();
        }
    }
    // Keep mono as mono and fold anything wider than stereo down to stereo:
    // the engine's spatial-stereo prefix only knows one or two channels.
    let out_channels = channels.min(2);
    let rate = if SUPPORTED_RATES.contains(&info.sample_rate) {
        info.sample_rate
    } else {
        TARGET_RATE
    };
    let resampled: Vec<Vec<f32>> = (0..out_channels)
        .map(|channel| {
            let lane: Vec<f32> = samples
                .iter()
                .skip(channel)
                .step_by(channels)
                .copied()
                .collect();
            resample_linear(&lane, info.sample_rate, rate)
        })
        .collect();
    Ok(encode_pcm16(&resampled, rate))
}

/// Refuse a clip longer than [`MAX_HITSOUND_SECONDS`] before anything is
/// allocated for it. Resampling keeps the duration, so checking the input
/// frames at the input rate bounds the output too.
fn refuse_if_too_long(frames: usize, rate: u32) -> Result<(), String> {
    if frames as u64 > MAX_HITSOUND_SECONDS * u64::from(rate) {
        let seconds = (frames as u64).div_ceil(u64::from(rate.max(1)));
        return Err(format!(
            "That WAV is about {seconds} seconds long. A hit sound is a fraction of a second; this app converts up to {MAX_HITSOUND_SECONDS} seconds."
        ));
    }
    Ok(())
}

/// Interleaved samples as f32 in [-1, 1], `channels` per frame, one flat
/// allocation for the whole clip.
fn decode_frames(data: &[u8], info: &WavInfo) -> Result<Vec<f32>, String> {
    let channels = usize::from(info.channels);
    let bits = usize::from(info.bits_per_sample);
    let sample_bytes = bits / 8;
    if sample_bytes == 0 || !bits.is_multiple_of(8) {
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
    let frame_bytes = sample_bytes
        .checked_mul(channels)
        .ok_or("WAV frame size overflowed.")?;
    if !data.len().is_multiple_of(frame_bytes) {
        return Err("That WAV ends with an incomplete PCM frame.".into());
    }
    let frame_count = data.len() / frame_bytes;
    refuse_if_too_long(frame_count, info.sample_rate)?;
    let mut samples = Vec::with_capacity(frame_count * channels);
    for frame in data.chunks_exact(frame_bytes) {
        for channel in 0..channels {
            let at = channel * sample_bytes;
            samples.push(decode(&frame[at..at + sample_bytes]).clamp(-1.0, 1.0));
        }
    }
    Ok(samples)
}

/// `from` and `to` are both inside the accepted rate band and the clip is
/// already length-checked, so the output is at most a few million samples.
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

const ADPCM_ADAPT: [i32; 16] = [
    230, 230, 230, 230, 307, 409, 512, 614, 768, 614, 512, 409, 307, 230, 230, 230,
];
/// Largest step the decoder keeps: the biggest `delta` whose product with the
/// largest adaptation factor still fits an i32 (ffmpeg's `INT_MAX / 768`).
const ADPCM_MAX_DELTA: i32 = i32::MAX / 768;

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
    let layout = ms_adpcm_layout(chunks.fmt, chunks.data, info.channels, info.bits_per_sample)?;
    let mut out: Vec<Vec<f32>> = vec![Vec::new(); channels];
    for block in chunks.data.chunks_exact(layout.block_align) {
        let mut predictor = [0usize; 2];
        let mut delta = [0i32; 2];
        let mut sample1 = [0i32; 2];
        let mut sample2 = [0i32; 2];
        for ch in 0..channels {
            predictor[ch] = usize::from(block[ch]);
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
            if produced >= layout.samples_per_block && ch == 0 {
                break;
            }
            let (c1, c2) = layout.coefficients[predictor[ch]];
            // Coefficients are signed 16-bit values from the file. Two
            // individually valid products can overflow i32 before the
            // fixed-point shift (for example -32768 * -32768 twice), so do
            // the adversarial arithmetic wide even though ordinary ADPCM
            // tables use much smaller coefficients.
            let predicted = ((i64::from(sample1[ch]) * i64::from(c1)
                + i64::from(sample2[ch]) * i64::from(c2))
                >> 8) as i32;
            let signed = if nibble & 0x08 != 0 {
                i32::from(nibble) - 16
            } else {
                i32::from(nibble)
            };
            let sample = (predicted + signed * delta[ch]).clamp(-32768, 32767);
            out[ch].push(sample as f32 / 32768.0);
            sample2[ch] = sample1[ch];
            sample1[ch] = sample;
            // Widen for the multiply and pin the step, as ffmpeg does: a run
            // of large nibbles otherwise grows `delta` past i32 in about a
            // dozen samples (a debug panic, wrapped garbage in release).
            let next = (i64::from(ADPCM_ADAPT[usize::from(nibble)]) * i64::from(delta[ch])) >> 8;
            delta[ch] = next.clamp(16, i64::from(ADPCM_MAX_DELTA)) as i32;
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
    validate_prepared_change(&hit)?;
    validate_prepared_change(&kill)?;
    let manifest = load_manifest(profiles_dir, profile_id)?;
    refuse_untracked_live_hitsound_files(profiles_dir, tf2_root, profile_id, &manifest)?;
    // Cache cleanup can fail (notably for a read-only file on Windows). Do it
    // before changing either slot so an error cannot leave new WAV bytes with
    // the previous HitsoundRecord.
    remove_live_sound_cache_if_active(profiles_dir, tf2_root, profile_id)?;
    let mut record = manifest.hitsound.clone().unwrap_or_default();
    let mut puts = Vec::new();
    let mut removes = Vec::new();
    for (kind, change) in [(HitsoundKind::Hit, &hit), (HitsoundKind::Kill, &kill)] {
        match change {
            HitsoundChange::Keep => {}
            HitsoundChange::Clear => {
                removes.push(kind.rel_path().to_string());
                set_slot(&mut record, kind, None);
            }
            HitsoundChange::Install { entry, wav } => {
                puts.push((
                    kind.rel_path().to_string(),
                    FileSource::Bytes(wav.as_slice()),
                ));
                set_slot(&mut record, kind, Some(entry.clone()));
            }
        }
    }
    let manifest = mutate_profile_files_to(
        profiles_dir,
        tf2_root,
        profile_id,
        &puts,
        &removes,
        ProfileLiveProjection::MirrorIfActive,
        &running,
        move |manifest| {
            manifest.hitsound = if record.hit.is_none() && record.kill.is_none() {
                None
            } else {
                Some(record)
            };
            Ok(())
        },
    )?;
    Ok(detail_from_manifest(&manifest))
}

fn validate_prepared_change(change: &HitsoundChange) -> Result<(), ProfileError> {
    let HitsoundChange::Install { entry, wav } = change else {
        return Ok(());
    };
    if entry.name.is_empty()
        || entry.name.len() > MAX_HITSOUND_ENTRY_NAME_BYTES
        || entry.name.chars().any(char::is_control)
    {
        return Err(ProfileError::Io(
            "A hit-sound name is empty, too long, or contains a control character.".into(),
        ));
    }
    for (field, value) in [("token", &entry.token), ("hash", &entry.hash)] {
        if value.as_ref().is_some_and(|value| {
            value.is_empty()
                || value.len() > MAX_HITSOUND_SOURCE_ID_BYTES
                || value.chars().any(char::is_control)
        }) {
            return Err(ProfileError::Io(format!(
                "The hit-sound source {field} is empty, too long, or contains a control character."
            )));
        }
    }
    if wav.is_empty() || wav.len() > HITSOUND_MAX_BYTES {
        return Err(ProfileError::Io(
            "That sound file is empty or too large.".into(),
        ));
    }
    let info = inspect_wav(wav).map_err(ProfileError::Io)?;
    if !wav_is_engine_ready(&info) {
        return Err(ProfileError::Io(
            "That WAV is not in a format TF2 plays. Prepare it first.".into(),
        ));
    }
    Ok(())
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
    let bytes = read_regular_file_bounded_within(profiles_dir, &path, HITSOUND_MAX_BYTES as u64)
        .ok()
        .flatten()?;
    inspect_wav(&bytes).ok()?;
    Some(bytes)
}

fn refuse_untracked_live_hitsound_files(
    profiles_dir: &Path,
    tf2_root: &Path,
    profile_id: &str,
    manifest: &ProfileManifest,
) -> Result<(), ProfileError> {
    let library = load_library_from(profiles_dir, Some(tf2_root))?;
    if library.active_profile_id.as_deref() != Some(profile_id) {
        return Ok(());
    }
    let dir = tf2_root
        .join("tf")
        .join("custom")
        .join(EXECS_HITSOUNDS_PACK);
    let meta = match std::fs::symlink_metadata(&dir) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Ok(meta) => meta,
        Err(err) => return Err(ProfileError::Io(err.to_string())),
    };
    if metadata_is_link(&meta) || !meta.is_dir() {
        return Err(ProfileError::Io(
            "Refusing to traverse a linked or invalid live hit-sound pack.".into(),
        ));
    }
    let tracked: BTreeSet<String> = manifest
        .files
        .iter()
        .filter(|file| matches!(file.path.as_str(), HITSOUND_REL | KILLSOUND_REL))
        .map(|file| file.path.to_ascii_lowercase())
        .collect();
    let cache_rel = format!("tf/custom/{EXECS_HITSOUNDS_PACK}/sound/sound.cache");
    let mut pending = vec![dir];
    let mut entries = 0usize;
    while let Some(current) = pending.pop() {
        validate_dir_within(tf2_root, &current).map_err(|err| ProfileError::Io(err.to_string()))?;
        for entry in std::fs::read_dir(&current).map_err(|err| ProfileError::Io(err.to_string()))? {
            let path = entry
                .map_err(|err| ProfileError::Io(err.to_string()))?
                .path();
            let meta = std::fs::symlink_metadata(&path)
                .map_err(|err| ProfileError::Io(err.to_string()))?;
            entries = entries.saturating_add(1);
            if entries > MAX_LIVE_HITSOUND_ENTRIES {
                return Err(ProfileError::Io(format!(
                    "The live hit-sound pack contains more than {MAX_LIVE_HITSOUND_ENTRIES} entries."
                )));
            }
            if metadata_is_link(&meta) {
                return Err(ProfileError::Io(
                    "Refusing to traverse a link or junction in the live hit-sound pack.".into(),
                ));
            }
            if meta.is_dir() {
                pending.push(path);
                continue;
            }
            if !meta.is_file() {
                return Err(ProfileError::Io(
                    "The live hit-sound pack contains an invalid entry.".into(),
                ));
            }
            let rel = path
                .strip_prefix(tf2_root)
                .map_err(|_| ProfileError::InvalidPath)?
                .to_string_lossy()
                .replace('\\', "/")
                .to_ascii_lowercase();
            if rel != cache_rel
                && !tracked.contains(&rel)
                && !rel.ends_with(crate::hash::PART_SUFFIX)
            {
                return Err(ProfileError::Io(format!(
                    "The live hit-sound pack contains an untracked file: {rel}. Remove or save it before applying."
                )));
            }
        }
    }
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
    // The game may have started after the caller's entry check. Sample again
    // at the destructive boundary just like the journaled live projection.
    refuse_if_running_among(live_process_names()).map_err(ProfileError::from)?;
    match std::fs::symlink_metadata(&cache) {
        Ok(_) => remove_file_force_within(tf2_root, &cache)
            .map_err(|err| ProfileError::Io(err.to_string()))?,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => return Err(ProfileError::Io(err.to_string())),
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

    #[cfg(unix)]
    fn link_dir(target: &Path, link: &Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    #[cfg(windows)]
    fn link_dir(target: &Path, link: &Path) {
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .status()
            .unwrap();
        assert!(status.success(), "could not create test junction");
    }

    #[cfg(unix)]
    fn unlink_dir(link: &Path) {
        std::fs::remove_file(link).unwrap();
    }

    #[cfg(windows)]
    fn unlink_dir(link: &Path) {
        std::fs::remove_dir(link).unwrap();
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
                entry: HitsoundEntry::new("quack".into(), HitsoundSource::Community),
                wav: wav.clone(),
            },
            HitsoundChange::Install {
                entry: HitsoundEntry::new("my kill.wav".into(), HitsoundSource::File),
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
        let mut permissions = std::fs::metadata(&cache).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&cache, permissions).unwrap();
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
                entry: HitsoundEntry::new("x".into(), HitsoundSource::File),
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
    fn apply_bounds_record_strings_at_the_core_boundary() {
        let wav = pcm_wav(44100, 1, 16, 20);
        let too_long = HitsoundChange::Install {
            entry: HitsoundEntry::new(
                "x".repeat(MAX_HITSOUND_ENTRY_NAME_BYTES + 1),
                HitsoundSource::File,
            ),
            wav: wav.clone(),
        };
        let err = validate_prepared_change(&too_long).unwrap_err();
        assert!(err.message().contains("name"), "{err:?}");

        let mut bad_token = HitsoundEntry::new("safe".into(), HitsoundSource::File);
        bad_token.token = Some("bad\nsource".into());
        let err = validate_prepared_change(&HitsoundChange::Install {
            entry: bad_token,
            wav,
        })
        .unwrap_err();
        assert!(err.message().contains("token"), "{err:?}");
    }

    #[test]
    fn both_slots_are_validated_before_either_is_changed() {
        let (root, profiles, tf2, id) = setup();
        let old = pcm_wav(44100, 1, 16, 20);
        apply_hitsounds_to(
            &profiles,
            &tf2,
            &id,
            HitsoundChange::Install {
                entry: HitsoundEntry::new("old".into(), HitsoundSource::File),
                wav: old.clone(),
            },
            HitsoundChange::Keep,
            unlocked(),
        )
        .unwrap();
        let before = load_manifest(&profiles, &id).unwrap();

        let err = apply_hitsounds_to(
            &profiles,
            &tf2,
            &id,
            HitsoundChange::Install {
                entry: HitsoundEntry::new("new".into(), HitsoundSource::File),
                wav: pcm_wav(44100, 1, 16, 20),
            },
            HitsoundChange::Install {
                entry: HitsoundEntry::new("bad".into(), HitsoundSource::File),
                wav: pcm_wav(48000, 1, 16, 20),
            },
            unlocked(),
        )
        .unwrap_err();

        assert!(err.message().contains("Prepare it first"), "{err:?}");
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        assert_eq!(std::fs::read(tf2.join(HITSOUND_REL)).unwrap(), old);
        assert!(!tf2.join(KILLSOUND_REL).exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn both_slots_and_record_roll_back_together_if_manifest_commit_fails() {
        let (root, profiles, tf2, id) = setup();
        let old = pcm_wav(44100, 1, 16, 20);
        apply_hitsounds_to(
            &profiles,
            &tf2,
            &id,
            HitsoundChange::Install {
                entry: HitsoundEntry::new("old hit".into(), HitsoundSource::File),
                wav: old.clone(),
            },
            HitsoundChange::Install {
                entry: HitsoundEntry::new("old kill".into(), HitsoundSource::File),
                wav: old.clone(),
            },
            unlocked(),
        )
        .unwrap();
        let before = load_manifest(&profiles, &id).unwrap();
        let blocker = crate::hash::part_path(&crate::profile::manifest_file(&profiles, &id));
        std::fs::create_dir_all(&blocker).unwrap();
        let replacement = pcm_wav(44100, 2, 16, 30);

        let err = apply_hitsounds_to(
            &profiles,
            &tf2,
            &id,
            HitsoundChange::Install {
                entry: HitsoundEntry::new("new hit".into(), HitsoundSource::Community),
                wav: replacement,
            },
            HitsoundChange::Clear,
            unlocked(),
        )
        .unwrap_err();
        assert!(matches!(err, ProfileError::Io(_)), "{err:?}");
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        assert_eq!(std::fs::read(tf2.join(HITSOUND_REL)).unwrap(), old);
        assert_eq!(std::fs::read(tf2.join(KILLSOUND_REL)).unwrap(), old);
        assert_eq!(
            stored_hitsound(&profiles, &id, HitsoundKind::Hit).unwrap(),
            old
        );
        assert_eq!(
            stored_hitsound(&profiles, &id, HitsoundKind::Kill).unwrap(),
            old
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn stored_hitsound_read_accepts_the_limit_and_rejects_one_byte_more() {
        let (root, profiles, _tf2, id) = setup();
        let path = exclusive_file_path(&profiles, &id, HITSOUND_REL);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut exact = pcm_wav(44100, 1, 16, 20);
        exact.resize(HITSOUND_MAX_BYTES, 0);
        std::fs::write(&path, &exact).unwrap();
        assert_eq!(
            stored_hitsound(&profiles, &id, HitsoundKind::Hit)
                .unwrap()
                .len(),
            HITSOUND_MAX_BYTES
        );

        exact.push(0);
        std::fs::write(&path, exact).unwrap();
        assert!(stored_hitsound(&profiles, &id, HitsoundKind::Hit).is_none());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn apply_refuses_a_linked_live_pack_without_touching_its_target() {
        let (root, profiles, tf2, id) = setup();
        let outside = root.join("outside-hitsound-pack");
        let outside_cache = outside.join("sound/sound.cache");
        std::fs::create_dir_all(outside_cache.parent().unwrap()).unwrap();
        std::fs::write(&outside_cache, b"outside cache").unwrap();
        let link = tf2.join("tf").join("custom").join(EXECS_HITSOUNDS_PACK);
        link_dir(&outside, &link);

        let err = apply_hitsounds_to(
            &profiles,
            &tf2,
            &id,
            HitsoundChange::Clear,
            HitsoundChange::Keep,
            unlocked(),
        )
        .unwrap_err();

        assert!(
            err.message().contains("link") || err.message().contains("reparse"),
            "{err:?}"
        );
        assert_eq!(std::fs::read(&outside_cache).unwrap(), b"outside cache");
        unlink_dir(&link);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn apply_refuses_untracked_content_in_the_app_owned_pack() {
        let (root, profiles, tf2, id) = setup();
        let stray = tf2.join("tf/custom/execs-hitsounds/cfg/autoexec.cfg");
        std::fs::create_dir_all(stray.parent().unwrap()).unwrap();
        std::fs::write(&stray, b"quit\n").unwrap();
        let before = load_manifest(&profiles, &id).unwrap();
        let wav = pcm_wav(44100, 1, 16, 20);

        let err = apply_hitsounds_to(
            &profiles,
            &tf2,
            &id,
            HitsoundChange::Install {
                entry: HitsoundEntry::new("new".into(), HitsoundSource::File),
                wav,
            },
            HitsoundChange::Keep,
            unlocked(),
        )
        .unwrap_err();
        assert!(err.message().contains("untracked"), "{err:?}");
        assert_eq!(load_manifest(&profiles, &id).unwrap(), before);
        assert_eq!(std::fs::read(stray).unwrap(), b"quit\n");
        assert!(!tf2.join(HITSOUND_REL).exists());
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
        adpcm_wav_with_delta(channels, blocks, nibble, 16)
    }

    fn adpcm_wav_with_delta(channels: u16, blocks: usize, nibble: u8, delta: i16) -> Vec<u8> {
        const COEFFICIENTS: [(i16, i16); 7] = [
            (256, 0),
            (512, -256),
            (0, 0),
            (192, 64),
            (240, 0),
            (460, -208),
            (392, -232),
        ];
        let block_align: u16 = 7 * channels + 8 * channels;
        let samples_per_block: u16 = 2 + 16;
        let byte_rate = 44100 * u32::from(block_align) / u32::from(samples_per_block);
        let mut fmt = Vec::new();
        fmt.extend_from_slice(&WAVE_FORMAT_ADPCM.to_le_bytes());
        fmt.extend_from_slice(&channels.to_le_bytes());
        fmt.extend_from_slice(&44100u32.to_le_bytes());
        fmt.extend_from_slice(&byte_rate.to_le_bytes());
        fmt.extend_from_slice(&block_align.to_le_bytes());
        fmt.extend_from_slice(&4u16.to_le_bytes());
        fmt.extend_from_slice(&32u16.to_le_bytes());
        fmt.extend_from_slice(&samples_per_block.to_le_bytes());
        fmt.extend_from_slice(&(COEFFICIENTS.len() as u16).to_le_bytes());
        for (first, second) in COEFFICIENTS {
            fmt.extend_from_slice(&first.to_le_bytes());
            fmt.extend_from_slice(&second.to_le_bytes());
        }
        let mut data = Vec::new();
        for _ in 0..blocks {
            // predictor 0: coef (256, 0) → predicted = sample1
            data.resize(data.len() + usize::from(channels), 0u8);
            for _ in 0..channels {
                data.extend_from_slice(&delta.to_le_bytes());
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
    fn comfig_style_adpcm_ignores_placeholder_byte_rate_and_times_blocks() {
        // Header shape observed in the pinned comfig hits library. Its
        // nAvgBytesPerSec is 16000, but the structurally valid stereo blocks
        // are 1024 bytes / 1012 samples and TF2 plays the file as-is.
        let mut wav = adpcm_wav(2, 1, 0);
        wav[28..32].copy_from_slice(&16000u32.to_le_bytes());
        wav[32..34].copy_from_slice(&1024u16.to_le_bytes());
        wav[38..40].copy_from_slice(&1012u16.to_le_bytes());
        wav.resize(78 + 1024, 0);
        wav[74..78].copy_from_slice(&1024u32.to_le_bytes());
        let riff_len = u32::try_from(wav.len() - 8).unwrap();
        wav[4..8].copy_from_slice(&riff_len.to_le_bytes());

        let info = inspect_wav(&wav).unwrap();
        assert!(wav_is_engine_ready(&info));
        assert_eq!(info.duration_ms, 22, "duration comes from complete blocks");
        let (installed, prepared) = prepare_hitsound_wav(&wav).unwrap();
        assert_eq!(installed, wav);
        assert_eq!(prepared.duration_ms, 22);
    }

    #[test]
    fn adversarial_adpcm_coefficients_do_not_overflow_the_decoder() {
        let mut wav = adpcm_wav(1, 1, 0);
        // Coefficient pair 0 and both seed samples are valid signed i16s, but
        // their two products overflow i32 before the fixed-point shift.
        wav[42..44].copy_from_slice(&i16::MIN.to_le_bytes());
        wav[44..46].copy_from_slice(&i16::MIN.to_le_bytes());
        wav[81..83].copy_from_slice(&i16::MIN.to_le_bytes());
        wav[83..85].copy_from_slice(&i16::MIN.to_le_bytes());

        let result = std::panic::catch_unwind(|| preview_wav(&wav));
        assert!(result.is_ok(), "valid hostile coefficients must not panic");
        let decoded = inspect_wav(&result.unwrap()).unwrap();
        assert_eq!(decoded.format_tag, WAVE_FORMAT_PCM);
        assert_eq!(decoded.bits_per_sample, 16);
    }

    #[test]
    fn malformed_ms_adpcm_is_never_treated_as_engine_ready() {
        let valid = adpcm_wav(1, 2, 0);

        let mut wrong_depth = valid.clone();
        wrong_depth[34..36].copy_from_slice(&16u16.to_le_bytes());
        assert!(prepare_hitsound_wav(&wrong_depth)
            .unwrap_err()
            .contains("4-bit"));

        let mut missing_coefficients = valid.clone();
        missing_coefficients[40..42].copy_from_slice(&8u16.to_le_bytes());
        assert!(inspect_wav(&missing_coefficients)
            .unwrap_err()
            .contains("coefficient table"));

        let mut bad_predictor = valid.clone();
        bad_predictor[78] = 7;
        assert!(inspect_wav(&bad_predictor)
            .unwrap_err()
            .contains("predictor"));

        let mut incomplete_block = valid;
        incomplete_block.pop();
        let data_len = u32::from_le_bytes(incomplete_block[74..78].try_into().unwrap()) - 1;
        incomplete_block[74..78].copy_from_slice(&data_len.to_le_bytes());
        let riff_len = (incomplete_block.len() - 8) as u32;
        incomplete_block[4..8].copy_from_slice(&riff_len.to_le_bytes());
        assert!(inspect_wav(&incomplete_block)
            .unwrap_err()
            .contains("incomplete audio block"));
    }

    #[test]
    fn pcm_header_and_data_alignment_are_validated() {
        let valid = pcm_wav(44100, 1, 16, 2);

        let mut wrong_alignment = valid.clone();
        wrong_alignment[32..34].copy_from_slice(&1u16.to_le_bytes());
        let info = inspect_wav(&wrong_alignment).unwrap();
        assert!(!wav_is_engine_ready(&info));
        let (_, repaired) = prepare_hitsound_wav(&wrong_alignment).unwrap();
        assert!(wav_is_engine_ready(&repaired));

        let mut wrong_byte_rate = valid.clone();
        wrong_byte_rate[28..32].copy_from_slice(&1u32.to_le_bytes());
        assert!(!wav_is_engine_ready(
            &inspect_wav(&wrong_byte_rate).unwrap()
        ));

        let mut incomplete_frame = valid;
        incomplete_frame.pop();
        incomplete_frame[40..44].copy_from_slice(&3u32.to_le_bytes());
        incomplete_frame[4..8].copy_from_slice(&39u32.to_le_bytes());
        assert!(prepare_hitsound_wav(&incomplete_frame)
            .unwrap_err()
            .contains("incomplete PCM frame"));
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
    #[test]
    fn boost_makes_the_file_louder_without_clipping_hard() {
        // A -20 dBFS sine: quiet, but not silence.
        let mut quiet = pcm_wav(44100, 1, 16, 441);
        for (index, sample) in quiet[44..].as_chunks_mut::<2>().0.iter_mut().enumerate() {
            let value = (index as f32 * 0.1).sin() * 3276.0;
            *sample = (value as i16).to_le_bytes();
        }
        let (plain, _) = prepare_hitsound_wav_boosted(&quiet, 0).unwrap();
        assert_eq!(plain, quiet);
        let (loud, info) = prepare_hitsound_wav_boosted(&quiet, 12).unwrap();
        assert_eq!(info.bits_per_sample, 16);
        assert_eq!(info.sample_rate, 44100);
        let peak = |wav: &[u8]| {
            let chunks = wav_chunks(wav).unwrap();
            chunks
                .data
                .as_chunks::<2>()
                .0
                .iter()
                .map(|b| i16::from_le_bytes(*b).unsigned_abs())
                .max()
                .unwrap_or(0)
        };
        assert!(peak(&loud) > peak(&quiet));
        assert!(peak(&loud) < 32767, "soft clip never pins to full scale");
        assert_eq!(clamp_boost_db(7), 6);
        assert_eq!(clamp_boost_db(40), 12);
    }

    /// A header claiming 8 Hz used to go through the resampler, which asked
    /// for `samples * 44100 / 8` floats — an allocation failure, and those
    /// abort the process rather than panic.
    #[test]
    fn an_absurd_header_rate_is_refused_not_resampled() {
        let err = prepare_hitsound_wav(&pcm_wav(8, 1, 16, 1000)).unwrap_err();
        assert!(err.contains("8 Hz"), "{err}");
        assert!(inspect_wav(&pcm_wav(7_999, 1, 16, 10)).is_err());
        assert!(inspect_wav(&pcm_wav(192_001, 1, 16, 10)).is_err());
        assert!(inspect_wav(&pcm_wav(8_000, 1, 16, 10)).is_ok());
        assert!(inspect_wav(&pcm_wav(192_000, 1, 16, 10)).is_ok());
        // The boosted path inspects the same header.
        let err = prepare_hitsound_wav_boosted(&pcm_wav(8, 1, 16, 1000), 6).unwrap_err();
        assert!(err.contains("8 Hz"), "{err}");
    }

    /// An honest low-rate, 8-bit file can be small on disk and huge once
    /// resampled to 16-bit 44.1 kHz. Refuse by duration before decoding so
    /// nothing that auditions is refused later at apply for its size.
    #[test]
    fn an_over_long_clip_is_refused_before_conversion() {
        let too_long = pcm_wav(8_000, 1, 8, 8_000 * 31);
        assert!(too_long.len() < HITSOUND_MAX_BYTES);
        let err = prepare_hitsound_wav(&too_long).unwrap_err();
        assert!(err.contains("31 seconds"), "{err}");
        let err = prepare_hitsound_wav_boosted(&too_long, 6).unwrap_err();
        assert!(err.contains("seconds"), "{err}");

        let at_the_limit = pcm_wav(8_000, 1, 8, 8_000 * 30);
        let (out, info) = prepare_hitsound_wav(&at_the_limit).unwrap();
        assert_eq!(info.sample_rate, 44100);
        assert!(
            out.len() <= HITSOUND_MAX_BYTES,
            "a clip under the duration cap always fits the apply size cap"
        );
    }

    fn extensible_pcm_wav(channels: u16, frames: usize) -> Vec<u8> {
        let block = channels * 2;
        let mut fmt = Vec::new();
        fmt.extend_from_slice(&WAVE_FORMAT_EXTENSIBLE.to_le_bytes());
        fmt.extend_from_slice(&channels.to_le_bytes());
        fmt.extend_from_slice(&44100u32.to_le_bytes());
        fmt.extend_from_slice(&(44100 * u32::from(block)).to_le_bytes());
        fmt.extend_from_slice(&block.to_le_bytes());
        fmt.extend_from_slice(&16u16.to_le_bytes());
        fmt.extend_from_slice(&22u16.to_le_bytes()); // cbSize
        fmt.extend_from_slice(&16u16.to_le_bytes()); // valid bits
        fmt.extend_from_slice(&3u32.to_le_bytes()); // channel mask
                                                    // KSDATAFORMAT_SUBTYPE_PCM: the tag in the first two bytes.
        fmt.extend_from_slice(&[
            0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xAA, 0x00, 0x38,
            0x9B, 0x71,
        ]);
        let mut data = Vec::new();
        for frame in 0..frames {
            for _ in 0..channels {
                let value = ((frame % 100) as f32 / 100.0) * 2.0 - 1.0;
                data.extend_from_slice(&((value * 32767.0) as i16).to_le_bytes());
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

    /// The Source mixer dispatches on the raw format tag and knows only PCM
    /// and MS-ADPCM, so an extensible-wrapped 16-bit 44.1 kHz file — exactly
    /// what modern editors export — played nothing when written verbatim.
    #[test]
    fn extensible_pcm_is_rewritten_with_a_plain_header() {
        let wav = extensible_pcm_wav(2, 441);
        let info = inspect_wav(&wav).unwrap();
        assert_eq!(info.format_tag, WAVE_FORMAT_PCM);
        assert_eq!(info.raw_format_tag, WAVE_FORMAT_EXTENSIBLE);
        assert!(!wav_is_engine_ready(&info));

        let (out, out_info) = prepare_hitsound_wav(&wav).unwrap();
        assert_ne!(out, wav);
        assert_eq!(out_info.raw_format_tag, WAVE_FORMAT_PCM);
        assert_eq!(out_info.format_tag, WAVE_FORMAT_PCM);
        assert_eq!(out_info.sample_rate, 44100);
        assert_eq!(out_info.bits_per_sample, 16);
        assert_eq!(out_info.channels, 2);
        assert_eq!(out_info.data_bytes, info.data_bytes);
        assert!(wav_is_engine_ready(&out_info));
        assert_eq!(read_u16(&out, 20), Some(WAVE_FORMAT_PCM), "raw tag on disk");

        let (boosted, boosted_info) = prepare_hitsound_wav_boosted(&wav, 6).unwrap();
        assert_eq!(boosted_info.raw_format_tag, WAVE_FORMAT_PCM);
        assert!(wav_is_engine_ready(&inspect_wav(&boosted).unwrap()));
    }

    /// A run of the largest nibble triples `delta` every sample; from a
    /// header delta of 32767 that overflowed i32 within a dozen samples.
    #[test]
    fn adpcm_step_growth_never_overflows() {
        let wav = adpcm_wav_with_delta(1, 2, 8, i16::MAX);
        let decoded = preview_wav(&wav);
        let info = inspect_wav(&decoded).unwrap();
        assert_eq!(
            info.format_tag, WAVE_FORMAT_PCM,
            "decoded, not passed through"
        );
        assert_eq!(info.data_bytes, 2 * 18 * 2);
        let at = decoded.len() - info.data_bytes;
        let samples: Vec<i16> = decoded[at..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|b| i16::from_le_bytes(*b))
            .collect();
        // Every nibble pushes down by 8 × delta: after each block's two
        // header samples the signal pins to the floor and stays there
        // instead of wrapping back positive.
        for block in samples.as_chunks::<18>().0 {
            assert_eq!(&block[..2], &[500, 1000], "{samples:?}");
            assert!(block[2..].iter().all(|s| *s <= -32767), "{samples:?}");
        }
        // The stereo variant walks the same path for both channels.
        let _ = preview_wav(&adpcm_wav_with_delta(2, 3, 8, i16::MAX));
        assert_eq!(ADPCM_MAX_DELTA, 2_796_202);
    }

    /// Editors leave `cue ` and `smpl` chunks in exports; the engine treats
    /// a cue point as a loop start. Even a file whose format qualifies is
    /// rewritten to fmt + data with its sample bytes untouched.
    #[test]
    fn an_engine_ready_file_is_rewritten_with_only_fmt_and_data() {
        let clean = pcm_wav(44100, 1, 16, 100);
        let mut cued = Vec::new();
        cued.extend_from_slice(&clean[..36]); // RIFF … fmt chunk
        cued.extend_from_slice(b"cue ");
        cued.extend_from_slice(&28u32.to_le_bytes());
        cued.extend_from_slice(&1u32.to_le_bytes()); // one cue point
        cued.extend_from_slice(&[0u8; 24]);
        cued.extend_from_slice(&clean[36..]); // data chunk
        cued.extend_from_slice(b"LIST");
        cued.extend_from_slice(&4u32.to_le_bytes());
        cued.extend_from_slice(b"INFO");
        let riff_len = (cued.len() - 8) as u32;
        cued[4..8].copy_from_slice(&riff_len.to_le_bytes());
        assert!(wav_is_engine_ready(&inspect_wav(&cued).unwrap()));

        let (out, info) = prepare_hitsound_wav(&cued).unwrap();
        assert_eq!(out, clean, "same samples, only fmt and data");
        assert!(wav_is_engine_ready(&info));
        assert!(!out.windows(4).any(|w| w == b"cue "));

        // ADPCM with an odd-length trailing chunk is rebuilt the same way.
        let adpcm = adpcm_wav(1, 2, 0);
        let mut tagged = adpcm.clone();
        tagged.extend_from_slice(b"smpl");
        tagged.extend_from_slice(&3u32.to_le_bytes());
        tagged.extend_from_slice(&[1, 2, 3, 0]);
        let riff_len = (tagged.len() - 8) as u32;
        tagged[4..8].copy_from_slice(&riff_len.to_le_bytes());
        let (out, info) = prepare_hitsound_wav(&tagged).unwrap();
        assert_eq!(out, adpcm);
        assert_eq!(info.raw_format_tag, WAVE_FORMAT_ADPCM);
    }
}
