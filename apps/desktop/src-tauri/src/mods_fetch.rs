//! Fetch Casual selection sources on demand. cueki's default library and the
//! original Flat Textures v1 author file are pinned and hash-verified under
//! the execs data dir, so installs work offline after each first download.

use std::path::Path;
use std::path::PathBuf;

use crate::net::{self, RemoteSource, Verify};

use execs_core::preloader::flat_textures;
use execs_core::preloader::ModsCatalog;
use execs_core::preloader::{MODS_RELEASE, MODS_SHA256};
const MODS_URL: &str =
    "https://github.com/cueki/casual-pre-loader/releases/download/v1.7.1/mods.zip";
/// ~81.5 MB — the UI warns before the first download.
pub const MODS_SIZE_BYTES: u64 = 81_529_475;

pub fn cache_path() -> PathBuf {
    execs_core::execs_data_dir()
        .join("preloader")
        .join(format!("mods-{MODS_RELEASE}.zip"))
}

/// Whether the complete, hash-verified release archive is already cached.
/// This is intentionally not just a length probe: a same-sized corrupt file
/// must not make the UI promise an offline install that will later fail.
pub fn is_cached() -> bool {
    net::cached_file_accepts(&cache_path(), Verify::Sha256(MODS_SHA256), MODS_SIZE_BYTES)
}

/// The library zip path, downloading and verifying it first if needed. The
/// hash is checked on a cache hit too: a truncated or tampered cache file is
/// re-downloaded rather than unzipped into the user's game.
pub fn ensure_mods_zip() -> Result<PathBuf, String> {
    let cached = cache_path();
    net::download_pinned_for(
        MODS_URL,
        &cached,
        Verify::Sha256(MODS_SHA256),
        MODS_SIZE_BYTES,
        RemoteSource::GitHubRelease,
    )
    .map_err(|err| {
        err.replace(
            "The download failed verification.",
            "The downloaded mod library failed verification.",
        )
    })?;
    // Do not return a stale/unverified path if the cache was replaced between
    // the download and this hand-off.
    if !net::cached_file_accepts(&cached, Verify::Sha256(MODS_SHA256), MODS_SIZE_BYTES) {
        return Err("The cached mod library failed verification.".into());
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

/// The direct author choice is visible before the larger cueki download.
/// Once that archive is cached, merge its other choices without ever offering
/// cueki's bundled copy of Flat Textures as a second source.
pub fn catalog_with_flat(cueki_zip: Option<&Path>) -> Result<ModsCatalog, String> {
    let mut catalog = match cueki_zip {
        Some(path) => execs_core::preloader::read_mods_catalog(path)?,
        None => ModsCatalog::default(),
    };
    catalog.addons.retain(|addon| addon.id != flat_textures::ID);
    catalog.addons.push(flat_textures::catalog_addon());
    catalog.addons.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(catalog)
}

#[cfg(test)]
mod tests {
    use super::{catalog_with_flat, pinned_flat_file_listed};
    use crate::gamebanana::GameBananaDownloadVariant;
    use execs_core::preloader::flat_textures;

    #[test]
    fn flat_choice_is_available_before_cueki_library_download() {
        let catalog = catalog_with_flat(None).unwrap();
        assert_eq!(catalog.addons.len(), 1);
        assert_eq!(catalog.addons[0].id, flat_textures::ID);
        assert_eq!(catalog.addons[0].file_count, flat_textures::PAYLOAD_FILES);
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
}
