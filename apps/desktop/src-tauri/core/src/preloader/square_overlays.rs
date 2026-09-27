//! Two existing Casual overlay choices sourced directly from the original
//! Square Series author archive. Only their pinned VPK game files enter the
//! local preloader pack; neither author archive nor VPK is exported in profiles.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::archive::{extract_archive, ArchiveLimits};
use crate::hash::sha256_hex;
use crate::vpk::read_vpk_dir_bytes;

use super::state::read_app_file_bounded;

pub const BURNING_ID: &str = "No Burning Overlay";
pub const SENTRY_ID: &str = "No Sentry Shield Overlay";
pub const MOD_ID: u64 = 435_309;
pub const FILE_ID: u64 = 1_261_092;
pub const ARCHIVE_FILE_NAME: &str = "squarever051.zip";
pub const ARCHIVE_BYTES: u64 = 3_976_414;
pub const ARCHIVE_SHA256: &str = "c6457f7c2704daccbbf66a1d962143b8ebc661b28a0a4884857d7a809f0f9aa9";
const BURNING_VPK_SHA256: &str = "e731ebb660cf76d85df9483722bdd1c53b7e18d1e88c61add806a8bb5795870b";
const SENTRY_VPK_SHA256: &str = "25656c67227b37265df9898c4e648f5701a92988d13819ec92d1c9a76e8f8783";
pub const BURNING_FILES: usize = 2;
pub const BURNING_BYTES: u64 = 175_232;
const BURNING_TREE_SHA256: &str =
    "3780a5a56b4717af39626b779dc48604d13b0b387cbb6e0c663b7d0ccea97c6b";
pub const SENTRY_FILES: usize = 4;
pub const SENTRY_BYTES: u64 = 175_509;
const SENTRY_TREE_SHA256: &str = "b5bf729e048554a1c5ebc98d918f25ebee94060aa38d4174d699d92e22f7a202";
const MAX_ENTRY_BYTES: u64 = 12 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 25 * 1024 * 1024;

pub fn is_overlay(id: &str) -> bool {
    id == BURNING_ID || id == SENTRY_ID
}

pub fn cache_path(data_dir: &Path) -> PathBuf {
    data_dir
        .join("preloader")
        .join(format!("square-overlays-{FILE_ID}.zip"))
}

pub fn catalog_addons() -> [super::CatalogAddon; 2] {
    [
        super::CatalogAddon {
            id: BURNING_ID.into(),
            name: BURNING_ID.into(),
            kind: "Texture".into(),
            description: "Original Square Series GameBanana file submitted by ghytd.".into(),
            file_count: BURNING_FILES,
            bytes: BURNING_BYTES,
            has_sound: false,
        },
        super::CatalogAddon {
            id: SENTRY_ID.into(),
            name: SENTRY_ID.into(),
            kind: "Texture".into(),
            description: "Original Square Series GameBanana file submitted by ghytd.".into(),
            file_count: SENTRY_FILES,
            bytes: SENTRY_BYTES,
            has_sound: false,
        },
    ]
}

fn verified_vpk_files(
    vpk: &[u8],
    id: &str,
    expected_sha256: &str,
    expected_files: usize,
    expected_bytes: u64,
    expected_tree_sha256: &str,
) -> Result<BTreeMap<String, Vec<u8>>, String> {
    if sha256_hex(vpk) != expected_sha256 {
        return Err(format!(
            "The {id} author VPK no longer matches its pinned revision."
        ));
    }
    let files = read_vpk_dir_bytes(vpk)
        .map_err(|err| format!("Could not read the {id} author VPK: {}", err.message()))?
        .files;
    let total = files
        .values()
        .map(|content| content.len() as u64)
        .sum::<u64>();
    let lines: Vec<String> = files
        .iter()
        .map(|(path, content)| format!("{path}:{}", sha256_hex(content)))
        .collect();
    if files.len() != expected_files
        || total != expected_bytes
        || sha256_hex(lines.join("\n").as_bytes()) != expected_tree_sha256
    {
        return Err(format!(
            "The {id} payload no longer matches its pinned game files."
        ));
    }
    Ok(files)
}

/// Verify the entire author ZIP, both selected VPKs, duplicate VPK copies, and
/// each game file tree before yielding paths under the existing saved IDs.
pub fn validate_bytes(bytes: &[u8]) -> Result<BTreeMap<String, Vec<u8>>, String> {
    if bytes.len() as u64 != ARCHIVE_BYTES || sha256_hex(bytes) != ARCHIVE_SHA256 {
        return Err(
            "The Square Series author archive no longer matches its pinned revision.".into(),
        );
    }
    let members = extract_archive(
        bytes,
        ArchiveLimits::new(256, MAX_ENTRY_BYTES, MAX_TOTAL_BYTES),
    )
    .map_err(|err| {
        format!(
            "Could not read the Square Series author archive: {}",
            err.message()
        )
    })?;
    let members: BTreeMap<_, _> = members.into_iter().collect();
    let burning = members
        .get("folder/NoBurningOverlay.vpk")
        .ok_or("The No Burning Overlay author VPK is missing.")?;
    let sentry = members
        .get("folder/NoSentryShieldOverlay.vpk")
        .ok_or("The No Sentry Shield Overlay author VPK is missing.")?;
    if members.get("vpk/NoBurningOverlay.vpk") != Some(burning)
        || members.get("vpk/NoSentryShieldOverlay.vpk") != Some(sentry)
    {
        return Err("The Square Series alternate VPK copies no longer match.".into());
    }
    let mut result = BTreeMap::new();
    for (id, vpk, sha256, count, size, tree) in [
        (
            BURNING_ID,
            burning.as_slice(),
            BURNING_VPK_SHA256,
            BURNING_FILES,
            BURNING_BYTES,
            BURNING_TREE_SHA256,
        ),
        (
            SENTRY_ID,
            sentry.as_slice(),
            SENTRY_VPK_SHA256,
            SENTRY_FILES,
            SENTRY_BYTES,
            SENTRY_TREE_SHA256,
        ),
    ] {
        let files = verified_vpk_files(vpk, id, sha256, count, size, tree)?;
        result.extend(
            files
                .into_iter()
                .map(|(path, content)| (format!("mods/addons/{id}/{path}"), content)),
        );
    }
    Ok(result)
}

pub(crate) fn read_verified(data_dir: &Path) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let path = cache_path(data_dir);
    let bytes = read_app_file_bounded(data_dir, &path, ARCHIVE_BYTES)?.ok_or_else(|| {
        "Download the Square Series overlay author file in Mods before applying or switching to this profile."
            .to_string()
    })?;
    validate_bytes(&bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    #[ignore = "requires EXECS_D7_SQUARE_ZIP and EXECS_D7_CUEKI_ZIP"]
    fn pinned_author_overlay_vpks_match_cueki_game_files() {
        let author = std::fs::read(std::env::var("EXECS_D7_SQUARE_ZIP").unwrap()).unwrap();
        let files = validate_bytes(&author).unwrap();
        assert_eq!(files.len(), BURNING_FILES + SENTRY_FILES);
        let cueki = std::env::var("EXECS_D7_CUEKI_ZIP").unwrap();
        let mut cueki = zip::ZipArchive::new(std::fs::File::open(cueki).unwrap()).unwrap();
        for (path, bytes) in &files {
            let mut entry = cueki.by_name(path).unwrap();
            let mut source = Vec::new();
            entry.read_to_end(&mut source).unwrap();
            assert_eq!(&source, bytes, "{path}");
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
