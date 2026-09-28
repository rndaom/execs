//! MP3 and Ogg Vorbis clips for hit and kill sounds.
//!
//! Most clips players find online are MP3 or OGG. They are decoded here to a
//! plain 16-bit PCM WAV, which then goes through the same preparation as any
//! WAV (`prepare_hitsound_wav`: engine rate and format, clean header). The
//! decoded audio is bounded by length before it can grow large.

use std::io::Cursor;

use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

/// Longer clips are refused; a hit sound plays on every hit.
pub const MAX_DECODED_SECONDS: usize = 30;

/// File extensions this module decodes, lowercase.
pub const DECODED_EXTENSIONS: [&str; 3] = ["mp3", "ogg", "oga"];

pub fn is_decoded_extension(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(_, extension)| {
        DECODED_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
    })
}

const UNREADABLE: &str = "That file is not an MP3 or Ogg Vorbis clip execs can read.";

/// Decode an MP3 or Ogg Vorbis clip to a 16-bit PCM WAV at its own rate.
pub fn decode_to_wav(bytes: &[u8], extension: &str) -> Result<Vec<u8>, String> {
    let source = MediaSourceStream::new(Box::new(Cursor::new(bytes.to_vec())), Default::default());
    let mut hint = Hint::new();
    hint.with_extension(&extension.to_ascii_lowercase());
    let mut format = symphonia::default::get_probe()
        .probe(
            &hint,
            source,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|_| UNREADABLE.to_string())?;
    let track = format
        .default_track(TrackType::Audio)
        .ok_or_else(|| UNREADABLE.to_string())?;
    let params = track
        .codec_params
        .as_ref()
        .and_then(|params| params.audio())
        .ok_or_else(|| UNREADABLE.to_string())?;
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(params, &AudioDecoderOptions::default())
        .map_err(|_| UNREADABLE.to_string())?;
    let track_id = track.id;

    let mut pcm: Vec<i16> = Vec::new();
    let mut layout: Option<(u32, usize)> = None;
    let mut scratch: Vec<i16> = Vec::new();
    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            Err(_) if !pcm.is_empty() => break,
            Err(_) => return Err(UNREADABLE.into()),
        };
        if packet.track_id != track_id {
            continue;
        }
        let buffer = match decoder.decode(&packet) {
            Ok(buffer) => buffer,
            // A damaged frame is skipped; the rest of the clip still plays.
            Err(Error::DecodeError(_)) => continue,
            Err(_) => return Err(UNREADABLE.into()),
        };
        let spec = buffer.spec();
        let this = (spec.rate(), spec.channels().count());
        if this.0 == 0 || !(1..=2).contains(&this.1) {
            return Err("Use a mono or stereo clip.".into());
        }
        if *layout.get_or_insert(this) != this {
            return Err("That clip changes format partway through.".into());
        }
        scratch.resize(buffer.samples_interleaved(), 0);
        buffer.copy_to_slice_interleaved(&mut scratch);
        pcm.extend_from_slice(&scratch);
        if pcm.len() > this.0 as usize * this.1 * MAX_DECODED_SECONDS {
            return Err(format!(
                "That clip is longer than {MAX_DECODED_SECONDS} seconds. Trim it to the part you want to hear."
            ));
        }
    }
    let Some((rate, channels)) = layout.filter(|_| !pcm.is_empty()) else {
        return Err("That clip has no sound.".into());
    };
    Ok(pcm16_wav(&pcm, rate, channels as u16))
}

fn pcm16_wav(samples: &[i16], rate: u32, channels: u16) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let block_align = channels * 2;
    let mut out = Vec::with_capacity(44 + samples.len() * 2);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * u32::from(block_align)).to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        out.extend_from_slice(&sample.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_only_the_decoded_extensions() {
        assert!(is_decoded_extension("Oof.MP3"));
        assert!(is_decoded_extension("ding.ogg"));
        assert!(!is_decoded_extension("ding.wav"));
        assert!(!is_decoded_extension("mp3"));
    }

    #[test]
    fn refuses_bytes_that_are_not_a_clip() {
        assert_eq!(
            decode_to_wav(b"not audio at all", "mp3").unwrap_err(),
            UNREADABLE
        );
        assert_eq!(decode_to_wav(b"OggS", "ogg").unwrap_err(), UNREADABLE);
    }

    /// Real clips are not committed (their rights belong to their authors).
    /// Point these at local files: `EXECS_MP3_SAMPLE=… EXECS_OGG_SAMPLE=…
    /// cargo test -p execs-core --lib audio_decode -- --ignored`.
    #[test]
    #[ignore = "needs local MP3/OGG clips"]
    fn decodes_local_sample_clips_into_engine_ready_wavs() {
        for (variable, extension) in [("EXECS_MP3_SAMPLE", "mp3"), ("EXECS_OGG_SAMPLE", "ogg")] {
            let Ok(path) = std::env::var(variable) else {
                continue;
            };
            let bytes = std::fs::read(&path).unwrap();
            let wav = decode_to_wav(&bytes, extension).unwrap();
            let (_, info) = crate::hitsound::prepare_hitsound_wav(&wav).unwrap();
            assert!(crate::hitsound::wav_is_engine_ready(&info), "{path}");
            eprintln!("{path}: {} ms at {} Hz", info.duration_ms, info.sample_rate);
        }
    }

    #[test]
    fn decodes_an_mp3_into_an_engine_ready_hit_sound() {
        let mp3 = include_bytes!("../fixtures/audio/tone-880hz-48k-stereo.mp3");
        let wav = decode_to_wav(mp3, "mp3").unwrap();
        let decoded = crate::hitsound::inspect_wav(&wav).unwrap();
        assert_eq!((decoded.channels, decoded.sample_rate), (2, 48_000));
        assert!(
            (350..=500).contains(&decoded.duration_ms),
            "{}",
            decoded.duration_ms
        );
        let (_, prepared) = crate::hitsound::prepare_hitsound_wav(&wav).unwrap();
        assert!(crate::hitsound::wav_is_engine_ready(&prepared));
    }

    #[test]
    fn explains_that_ogg_opus_is_not_read() {
        let opus = include_bytes!("../fixtures/audio/tone-660hz-opus.ogg");
        assert_eq!(decode_to_wav(opus, "ogg").unwrap_err(), UNREADABLE);
    }

    #[test]
    fn writes_a_wav_the_hitsound_preparation_reads() {
        let wav = pcm16_wav(&[0, 1000, -1000, 0], 48_000, 2);
        let info = crate::hitsound::inspect_wav(&wav).unwrap();
        assert_eq!(
            (info.channels, info.sample_rate, info.bits_per_sample),
            (2, 48_000, 16)
        );
        let (prepared, prepared_info) = crate::hitsound::prepare_hitsound_wav(&wav).unwrap();
        assert!(crate::hitsound::wav_is_engine_ready(&prepared_info));
        assert!(!prepared.is_empty());
    }
}
