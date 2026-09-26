//! The original Developer Textures Overhaul v2 author file for the existing
//! Casual selection. The 7z and its single-file VPK are pinned, and only the
//! verified virtual game files are projected into the local preloader pack.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::archive::{extract_archive, ArchiveLimits};
use crate::hash::sha256_hex;
use crate::vpk::read_vpk_dir_bytes;

use super::state::read_app_file_bounded;

pub const ID: &str = "Developer Textures Overhaul v2";
pub const FILE_ID: u64 = 700_047;
pub const MOD_ID: u64 = 336_110;
pub const ARCHIVE_FILE_NAME: &str = "developer_textures_overhaul_v2.7z";
pub const ARCHIVE_BYTES: u64 = 2_817_041;
pub const ARCHIVE_SHA256: &str = "c0e7b0e846a65f878a2537d12c9fd4c407f8f4a577a329efc9ebd727b5e531cc";
pub const VPK_SHA256: &str = "3c6cd88088c295ebe7be64d0c977486411f151524bffe8113dbcf549d8ebb19e";
pub const PAYLOAD_FILES: usize = 996;
pub const PAYLOAD_BYTES: u64 = 55_750_859;
pub const PAYLOAD_TREE_SHA256: &str =
    "6856ddd081adc1d9bd2ec721521557f928bb2fad0a061f7d2e5882c2ff3baba1";
const VPK_FILE_NAME: &str = "Developer Textures Overhaul v2.vpk";
const MAX_VPK_BYTES: u64 = 60 * 1024 * 1024;

pub fn cache_path(data_dir: &Path) -> PathBuf {
    data_dir
        .join("preloader")
        .join(format!("developer-textures-v2-{FILE_ID}.7z"))
}

pub fn catalog_addon() -> super::CatalogAddon {
    super::CatalogAddon {
        id: ID.into(),
        name: ID.into(),
        kind: "Texture".into(),
        description: "FPS_Engineer rework; earlier pack reuploaded by ayrtonSilna, original maker unidentified."
            .into(),
        file_count: PAYLOAD_FILES,
        bytes: PAYLOAD_BYTES,
        has_sound: false,
    }
}

/// Return the exact virtual files to mount under the existing saved choice.
/// Full-archive, contained-VPK, and game-tree digests all have to agree.
pub fn validate_bytes(bytes: &[u8]) -> Result<BTreeMap<String, Vec<u8>>, String> {
    if bytes.len() as u64 != ARCHIVE_BYTES || sha256_hex(bytes) != ARCHIVE_SHA256 {
        return Err(
            "The Developer Textures author archive no longer matches its pinned revision.".into(),
        );
    }
    let files = extract_archive(bytes, ArchiveLimits::new(8, MAX_VPK_BYTES, MAX_VPK_BYTES))
        .map_err(|err| {
            format!(
                "Could not read the Developer Textures author archive: {}",
                err.message()
            )
        })?;
    let mut vpk = None;
    for (path, content) in files {
        if path.ends_with(VPK_FILE_NAME) {
            if vpk.replace(content).is_some() {
                return Err(
                    "The Developer Textures author archive contains duplicate VPKs.".into(),
                );
            }
        } else if path.to_ascii_lowercase().ends_with(".vpk") {
            return Err("The Developer Textures author archive contains an unexpected VPK.".into());
        }
    }
    let vpk = vpk.ok_or("The Developer Textures author VPK is missing.")?;
    if sha256_hex(&vpk) != VPK_SHA256 {
        return Err(
            "The Developer Textures author VPK no longer matches its pinned revision.".into(),
        );
    }
    let game_files = read_vpk_dir_bytes(&vpk)
        .map_err(|err| {
            format!(
                "Could not read the Developer Textures author VPK: {}",
                err.message()
            )
        })?
        .files;
    let total = game_files
        .values()
        .map(|content| content.len() as u64)
        .sum::<u64>();
    let mut lines: Vec<String> = game_files
        .iter()
        .map(|(path, content)| format!("{path}:{}", sha256_hex(content)))
        .collect();
    lines.sort();
    if game_files.len() != PAYLOAD_FILES
        || total != PAYLOAD_BYTES
        || sha256_hex(lines.join("\n").as_bytes()) != PAYLOAD_TREE_SHA256
    {
        return Err(
            "The Developer Textures payload no longer matches the pinned game files.".into(),
        );
    }
    Ok(game_files
        .into_iter()
        .map(|(path, content)| (format!("mods/addons/{ID}/{path}"), content))
        .collect())
}

pub(crate) fn read_verified(data_dir: &Path) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let path = cache_path(data_dir);
    let bytes = read_app_file_bounded(data_dir, &path, ARCHIVE_BYTES)?.ok_or_else(|| {
        "Download Developer Textures Overhaul v2 in Mods before applying or switching to this profile."
            .to_string()
    })?;
    validate_bytes(&bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    /// The fixtures are original downloads outside the repository. Run this
    /// explicitly when qualifying a source or changing its reader.
    #[test]
    #[ignore = "requires EXECS_D7_DEVELOPER_7Z and EXECS_D7_CUEKI_ZIP"]
    fn pinned_author_vpk_matches_every_cueki_game_file() {
        let author = std::fs::read(std::env::var("EXECS_D7_DEVELOPER_7Z").unwrap()).unwrap();
        let files = validate_bytes(&author).unwrap();
        assert_eq!(files.len(), PAYLOAD_FILES);
        let cueki = std::env::var("EXECS_D7_CUEKI_ZIP").unwrap();
        let mut cueki = zip::ZipArchive::new(std::fs::File::open(cueki).unwrap()).unwrap();
        for (virtual_path, author_bytes) in &files {
            let mut entry = cueki.by_name(virtual_path).unwrap();
            let mut cueki_bytes = Vec::new();
            entry.read_to_end(&mut cueki_bytes).unwrap();
            assert_eq!(&cueki_bytes, author_bytes, "{virtual_path}");
        }
    }

    #[test]
    fn same_sized_corrupt_archive_is_refused() {
        let bytes = vec![0; ARCHIVE_BYTES as usize];
        assert!(validate_bytes(&bytes)
            .unwrap_err()
            .contains("pinned revision"));
    }
}
