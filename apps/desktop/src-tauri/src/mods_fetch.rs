//! Fetch the verified direct-author Casual sources on demand. Existing cueki
//! selections may use a previously cached, hash-verified library; new library
//! downloads are retired while its source-asset rights remain unresolved.

use std::path::{Path, PathBuf};

use crate::net::{self, RemoteSource, Verify};

use execs_core::preloader::ModsCatalog;
use execs_core::preloader::{developer_textures, flat_textures, square_overlays};
use execs_core::preloader::{MODS_RELEASE, MODS_SHA256};
/// Exact size of the formerly downloaded library, retained for cache checks.
pub const MODS_SIZE_BYTES: u64 = 81_529_475;

pub fn cache_path() -> PathBuf {
    cache_path_for(&execs_core::execs_data_dir())
}

pub fn cache_path_for(data_dir: &Path) -> PathBuf {
    data_dir
        .join("preloader")
        .join(format!("mods-{MODS_RELEASE}.zip"))
}

/// Whether the complete, hash-verified release archive is already cached.
/// This is intentionally not just a length probe: a same-sized corrupt file
/// must not make the UI promise an offline install that will later fail.
pub fn is_cached() -> bool {
    is_cached_at(&execs_core::execs_data_dir())
}

pub fn is_cached_at(data_dir: &Path) -> bool {
    let path = cache_path_for(data_dir);
    if execs_core::hash::validate_file_within(data_dir, &path).is_err() {
        return false;
    }
    std::fs::symlink_metadata(&path)
        .is_ok_and(|metadata| metadata.is_file() && metadata.len() == MODS_SIZE_BYTES)
        && execs_core::hash::sha256_file(&path).ok().as_deref() == Some(MODS_SHA256)
}

/// Reuse only an existing, exact library cache for a saved legacy selection.
/// A missing or modified archive never triggers a fresh download.
pub fn verified_legacy_mods_zip() -> Result<PathBuf, String> {
    let cached = cache_path();
    if !net::cached_file_accepts(&cached, Verify::Sha256(MODS_SHA256), MODS_SIZE_BYTES) {
        return Err("This saved Casual choice needs the previously verified mod library cache. New downloads of that library are paused while its asset rights are unresolved. Remove the saved library choices in Casual setup or restore the original cache on this device.".into());
    }
    Ok(cached)
}

/// Fetch the original author file for the existing Flat Textures v1 choice.
/// A fresh GameBanana download-page check binds the fixed mod and file IDs to
/// the author-visible name and size before the approved /dl/ redirect chain.
/// Cache hits still require the full pinned SHA-256 and payload-tree digest.
pub fn ensure_flat_textures_zip() -> Result<PathBuf, String> {
    let cached = flat_textures::cache_path(&execs_core::execs_data_dir());
    if !net::cached_file_accepts(
        &cached,
        Verify::Sha256(flat_textures::ZIP_SHA256),
        flat_textures::ZIP_BYTES,
    ) {
        let listed = pinned_flat_file_listed(&crate::gamebanana::download_variants(
            flat_textures::MOD_ID,
        )?);
        if !listed {
            return Err(
                "The pinned Flat Textures v1 author file is no longer listed as expected.".into(),
            );
        }
    }
    net::download_pinned_validated_for(
        &format!("https://gamebanana.com/dl/{}", flat_textures::FILE_ID),
        &cached,
        Verify::Sha256(flat_textures::ZIP_SHA256),
        flat_textures::ZIP_BYTES,
        RemoteSource::GameBananaDownload,
        |bytes| flat_textures::validate_bytes(bytes).map(|_| ()),
    )?;
    Ok(cached)
}

fn pinned_flat_file_listed(files: &[crate::gamebanana::GameBananaDownloadVariant]) -> bool {
    files.iter().any(|file| {
        file.id == flat_textures::FILE_ID
            && file.file_name == flat_textures::ZIP_FILE_NAME
            && file.size_bytes == Some(flat_textures::ZIP_BYTES)
            && file.supported
    })
}

/// Fetch the original Developer Textures author 7z. The fixed file must still
/// appear under its author mod before any cache miss follows GameBanana /dl/.
pub fn ensure_developer_textures_7z() -> Result<PathBuf, String> {
    let cached = developer_textures::cache_path(&execs_core::execs_data_dir());
    if !net::cached_file_accepts(
        &cached,
        Verify::Sha256(developer_textures::ARCHIVE_SHA256),
        developer_textures::ARCHIVE_BYTES,
    ) && !pinned_developer_file_listed(&crate::gamebanana::download_variants(
        developer_textures::MOD_ID,
    )?) {
        return Err(
            "The pinned Developer Textures author file is no longer listed as expected.".into(),
        );
    }
    net::download_pinned_validated_for(
        &format!("https://gamebanana.com/dl/{}", developer_textures::FILE_ID),
        &cached,
        Verify::Sha256(developer_textures::ARCHIVE_SHA256),
        developer_textures::ARCHIVE_BYTES,
        RemoteSource::GameBananaDownload,
        |bytes| developer_textures::validate_bytes(bytes).map(|_| ()),
    )?;
    Ok(cached)
}

fn pinned_developer_file_listed(files: &[crate::gamebanana::GameBananaDownloadVariant]) -> bool {
    files.iter().any(|file| {
        file.id == developer_textures::FILE_ID
            && file.file_name == developer_textures::ARCHIVE_FILE_NAME
            && file.size_bytes == Some(developer_textures::ARCHIVE_BYTES)
            && file.supported
    })
}

/// Fetch the pinned original Square Series file shared by the two overlay
/// choices. Cache misses recheck its author listing before following /dl/.
pub fn ensure_square_overlays_zip() -> Result<PathBuf, String> {
    let cached = square_overlays::cache_path(&execs_core::execs_data_dir());
    if !net::cached_file_accepts(
        &cached,
        Verify::Sha256(square_overlays::ARCHIVE_SHA256),
        square_overlays::ARCHIVE_BYTES,
    ) && !pinned_square_file_listed(&crate::gamebanana::download_variants(
        square_overlays::MOD_ID,
    )?) {
        return Err("The pinned Square Series author file is no longer listed as expected.".into());
    }
    net::download_pinned_validated_for(
        &format!("https://gamebanana.com/dl/{}", square_overlays::FILE_ID),
        &cached,
        Verify::Sha256(square_overlays::ARCHIVE_SHA256),
        square_overlays::ARCHIVE_BYTES,
        RemoteSource::GameBananaDownload,
        |bytes| square_overlays::validate_bytes(bytes).map(|_| ()),
    )?;
    Ok(cached)
}

fn pinned_square_file_listed(files: &[crate::gamebanana::GameBananaDownloadVariant]) -> bool {
    files.iter().any(|file| {
        file.id == square_overlays::FILE_ID
            && file.file_name == square_overlays::ARCHIVE_FILE_NAME
            && file.size_bytes == Some(square_overlays::ARCHIVE_BYTES)
            && file.supported
    })
}

/// New Casual choices are limited to the four pinned direct-author files.
/// Saved cueki choices are surfaced separately from the profile's selection.
pub fn direct_catalog() -> ModsCatalog {
    let mut catalog = ModsCatalog::default();
    catalog.addons.push(flat_textures::catalog_addon());
    catalog.addons.push(developer_textures::catalog_addon());
    catalog.addons.extend(square_overlays::catalog_addons());
    catalog.addons.sort_by(|a, b| a.id.cmp(&b.id));
    catalog
}

#[cfg(test)]
mod tests {
    use super::{
        direct_catalog, pinned_developer_file_listed, pinned_flat_file_listed,
        pinned_square_file_listed,
    };
    use crate::gamebanana::GameBananaDownloadVariant;
    use crate::net::{self, RemoteSource};
    use execs_core::preloader::{developer_textures, flat_textures, square_overlays};
    use std::time::Duration;

    #[test]
    fn direct_choices_are_the_only_new_casual_choices() {
        let catalog = direct_catalog();
        assert_eq!(catalog.addons.len(), 4);
        assert_eq!(catalog.addons[0].id, developer_textures::ID);
        assert_eq!(
            catalog.addons[0].file_count,
            developer_textures::PAYLOAD_FILES
        );
        assert_eq!(catalog.addons[1].id, flat_textures::ID);
        assert_eq!(catalog.addons[1].file_count, flat_textures::PAYLOAD_FILES);
        assert_eq!(catalog.addons[2].id, square_overlays::BURNING_ID);
        assert_eq!(catalog.addons[3].id, square_overlays::SENTRY_ID);
        assert!(catalog.particle_mods.is_empty());
    }

    #[test]
    fn author_file_identity_needs_exact_gamebanana_listing_metadata() {
        let exact = GameBananaDownloadVariant {
            id: flat_textures::FILE_ID,
            file_name: flat_textures::ZIP_FILE_NAME.into(),
            description: String::new(),
            size_bytes: Some(flat_textures::ZIP_BYTES),
            added_at: None,
            supported: true,
        };
        assert!(pinned_flat_file_listed(std::slice::from_ref(&exact)));
        let mut changed = exact.clone();
        changed.id += 1;
        assert!(!pinned_flat_file_listed(&[changed]));
        let mut changed = exact.clone();
        changed.file_name = "flattexturesv2.zip".into();
        assert!(!pinned_flat_file_listed(&[changed]));
        let mut changed = exact.clone();
        changed.size_bytes = Some(flat_textures::ZIP_BYTES + 1);
        assert!(!pinned_flat_file_listed(&[changed]));
        let mut changed = exact;
        changed.supported = false;
        assert!(!pinned_flat_file_listed(&[changed]));
    }

    #[test]
    fn developer_author_file_needs_exact_listing_metadata() {
        let exact = GameBananaDownloadVariant {
            id: developer_textures::FILE_ID,
            file_name: developer_textures::ARCHIVE_FILE_NAME.into(),
            description: String::new(),
            size_bytes: Some(developer_textures::ARCHIVE_BYTES),
            added_at: None,
            supported: true,
        };
        assert!(pinned_developer_file_listed(std::slice::from_ref(&exact)));
        let mut changed = exact.clone();
        changed.id += 1;
        assert!(!pinned_developer_file_listed(&[changed]));
        let mut changed = exact.clone();
        changed.file_name = "other.7z".into();
        assert!(!pinned_developer_file_listed(&[changed]));
        let mut changed = exact.clone();
        changed.size_bytes = None;
        assert!(!pinned_developer_file_listed(&[changed]));
        let mut changed = exact;
        changed.supported = false;
        assert!(!pinned_developer_file_listed(&[changed]));
    }

    #[test]
    fn square_author_file_needs_exact_listing_metadata() {
        let exact = GameBananaDownloadVariant {
            id: square_overlays::FILE_ID,
            file_name: square_overlays::ARCHIVE_FILE_NAME.into(),
            description: String::new(),
            size_bytes: Some(square_overlays::ARCHIVE_BYTES),
            added_at: None,
            supported: true,
        };
        assert!(pinned_square_file_listed(std::slice::from_ref(&exact)));
        let mut changed = exact.clone();
        changed.id += 1;
        assert!(!pinned_square_file_listed(&[changed]));
        let mut changed = exact.clone();
        changed.file_name = "squarever052.zip".into();
        assert!(!pinned_square_file_listed(&[changed]));
        let mut changed = exact.clone();
        changed.size_bytes = None;
        assert!(!pinned_square_file_listed(&[changed]));
        let mut changed = exact;
        changed.supported = false;
        assert!(!pinned_square_file_listed(&[changed]));
    }

    /// Exercises the current author listing and approved live /dl/ redirect
    /// chain without writing to the user's cache or TF2 installation.
    #[test]
    #[ignore = "live GameBanana author-file regression"]
    fn live_flat_textures_author_file_matches_the_pinned_payload() {
        let files = crate::gamebanana::download_variants(flat_textures::MOD_ID).unwrap();
        assert!(pinned_flat_file_listed(&files));
        let bytes = net::download_bytes_for_timeout(
            &format!("https://gamebanana.com/dl/{}", flat_textures::FILE_ID),
            flat_textures::ZIP_BYTES,
            RemoteSource::GameBananaDownload,
            Some(Duration::from_secs(45)),
        )
        .unwrap();
        flat_textures::validate_bytes(&bytes).unwrap();
    }

    #[test]
    #[ignore = "live GameBanana author-file regression"]
    fn live_developer_textures_author_file_matches_the_pinned_payload() {
        let files = crate::gamebanana::download_variants(developer_textures::MOD_ID).unwrap();
        assert!(pinned_developer_file_listed(&files));
        let bytes = net::download_bytes_for_timeout(
            &format!("https://gamebanana.com/dl/{}", developer_textures::FILE_ID),
            developer_textures::ARCHIVE_BYTES,
            RemoteSource::GameBananaDownload,
            Some(Duration::from_secs(60)),
        )
        .unwrap();
        developer_textures::validate_bytes(&bytes).unwrap();
    }

    #[test]
    #[ignore = "live GameBanana author-file regression"]
    fn live_square_overlays_author_file_matches_the_pinned_payload() {
        let files = crate::gamebanana::download_variants(square_overlays::MOD_ID).unwrap();
        assert!(pinned_square_file_listed(&files));
        let bytes = net::download_bytes_for_timeout(
            &format!("https://gamebanana.com/dl/{}", square_overlays::FILE_ID),
            square_overlays::ARCHIVE_BYTES,
            RemoteSource::GameBananaDownload,
            Some(Duration::from_secs(60)),
        )
        .unwrap();
        square_overlays::validate_bytes(&bytes).unwrap();
    }
}
