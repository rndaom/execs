//! The author's original Flat Textures v1 archive, used directly for the
//! existing `Flat Textures v1` Casual selection. Only its loose game payload
//! is mounted locally; the author ZIP is never copied into a profile export.

use std::collections::BTreeSet;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use crate::hash::sha256_hex;

use super::state::read_app_file_bounded;

pub const ID: &str = "Flat Textures v1";
pub const FILE_ID: u64 = 677_961;
pub const MOD_ID: u64 = 295_065;
pub const ZIP_FILE_NAME: &str = "flattexturesv1.zip";
pub const ZIP_BYTES: u64 = 1_128_087;
pub const ZIP_SHA256: &str = "2c62ee8bdb9d43626bc6d3ce1fc5d243c1020fd945c60738f67528f8096ea681";
pub const PAYLOAD_FILES: usize = 3_143;
pub const PAYLOAD_BYTES: u64 = 337_882;
pub const PAYLOAD_TREE_SHA256: &str =
    "a3559ea284de08de00fb25645d023de0326b6f1af05552af922e0b603be891fd";
const ROOT: &str = "FlatTexturesV1/";

pub fn cache_path(data_dir: &Path) -> PathBuf {
    data_dir
        .join("preloader")
        .join(format!("flattexturesv1-{FILE_ID}.zip"))
}

pub fn catalog_addon() -> super::CatalogAddon {
    super::CatalogAddon {
        id: ID.into(),
        name: ID.into(),
        kind: "Texture".into(),
        description: "Original GameBanana file by flewvar; textures credited to JarateKing.".into(),
        file_count: PAYLOAD_FILES,
        bytes: PAYLOAD_BYTES,
        has_sound: false,
    }
}

/// Validate both the complete pinned author file and every loose game file.
/// The returned indices map source entries to their paths inside the existing
/// preloader's virtual library. A content-only tree digest documents the
/// byte-preserving equivalence checked against cueki's addon.
pub fn validate_bytes(bytes: &[u8]) -> Result<Vec<(usize, String)>, String> {
    if bytes.len() as u64 != ZIP_BYTES || sha256_hex(bytes) != ZIP_SHA256 {
        return Err(
            "The Flat Textures author archive no longer matches its pinned revision.".into(),
        );
    }
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|err| format!("Could not read the Flat Textures author archive: {err}"))?;
    let mut files = Vec::new();
    let mut lines = Vec::new();
    let mut portable_paths = BTreeSet::new();
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|err| format!("Could not read the Flat Textures author archive: {err}"))?;
        if entry.is_dir() {
            continue;
        }
        let Some(relative) = entry.name().strip_prefix(ROOT).map(str::to_owned) else {
            continue;
        };
        if relative.is_empty()
            || relative.contains('\\')
            || relative.starts_with('/')
            || relative
                .split('/')
                .any(|part| part.is_empty() || part == "." || part == "..")
            || !portable_paths.insert(relative.to_ascii_lowercase())
        {
            return Err("The Flat Textures author archive has an unsafe or duplicate path.".into());
        }
        total = total
            .checked_add(entry.size())
            .ok_or("The Flat Textures payload exceeds its safety limit.")?;
        if total > PAYLOAD_BYTES || files.len() >= PAYLOAD_FILES {
            return Err("The Flat Textures payload exceeds its pinned limits.".into());
        }
        let mut content = Vec::with_capacity(entry.size() as usize);
        entry
            .read_to_end(&mut content)
            .map_err(|err| format!("Could not read the Flat Textures payload: {err}"))?;
        lines.push(format!("{relative}:{}", sha256_hex(&content)));
        files.push((index, format!("mods/addons/{ID}/{relative}")));
    }
    lines.sort();
    if files.len() != PAYLOAD_FILES
        || total != PAYLOAD_BYTES
        || sha256_hex(lines.join("\n").as_bytes()) != PAYLOAD_TREE_SHA256
    {
        return Err("The Flat Textures payload no longer matches the pinned game files.".into());
    }
    Ok(files)
}

pub(crate) struct VerifiedArchive {
    pub bytes: Vec<u8>,
    pub entries: Vec<(usize, String)>,
}

pub(crate) fn read_verified(data_dir: &Path) -> Result<VerifiedArchive, String> {
    let path = cache_path(data_dir);
    let bytes = read_app_file_bounded(data_dir, &path, ZIP_BYTES)?.ok_or_else(|| {
        "Download Flat Textures v1 in Mods before applying or switching to this profile."
            .to_string()
    })?;
    let entries = validate_bytes(&bytes)?;
    Ok(VerifiedArchive { bytes, entries })
}
