//! Fetch official mastercomfig GitHub Release VPKs. Core stays network-free.

use execs_core::{download_urls_for_spec, GitHubAsset, GitHubRelease, WizardSpec};
use serde::Deserialize;

use crate::net::{self, RemoteSource, MIB};

const RELEASE_URL: &str = "https://api.github.com/repos/mastercomfig/mastercomfig/releases/latest";

/// The whole mastercomfig release is a few MB; 256 MiB is a ceiling, not a
/// target.
const VPK_MAX_BYTES: u64 = 256 * MIB;

#[derive(Debug, Deserialize)]
struct PublishedRelease {
    #[serde(default)]
    assets: Vec<PublishedAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct PublishedAsset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    digest: Option<String>,
}

impl PublishedRelease {
    fn core_shape(&self) -> GitHubRelease {
        GitHubRelease {
            assets: self
                .assets
                .iter()
                .map(|asset| GitHubAsset {
                    name: asset.name.clone(),
                    browser_download_url: asset.browser_download_url.clone(),
                })
                .collect(),
        }
    }

    fn selected(&self, urls: Vec<(String, String)>) -> Result<Vec<SelectedAsset>, String> {
        urls.into_iter()
            .map(|(rel, url)| {
                let name = rel.rsplit('/').next().unwrap_or(&rel);
                let asset = self
                    .assets
                    .iter()
                    .find(|asset| asset.name.eq_ignore_ascii_case(name))
                    .ok_or_else(|| format!("Official mastercomfig release is missing {name}."))?;
                if asset.browser_download_url != url {
                    return Err(format!(
                        "Official mastercomfig release has conflicting URLs for {name}."
                    ));
                }
                let sha256 = published_sha256(asset)?;
                validate_asset_url(asset)?;
                Ok(SelectedAsset {
                    rel,
                    url,
                    sha256: sha256.to_string(),
                })
            })
            .collect()
    }
}

struct SelectedAsset {
    rel: String,
    url: String,
    sha256: String,
}

fn published_sha256(asset: &PublishedAsset) -> Result<&str, String> {
    let digest = asset.digest.as_deref().ok_or_else(|| {
        format!(
            "GitHub did not publish a SHA-256 digest for {}.",
            asset.name
        )
    })?;
    let sha256 = digest
        .strip_prefix("sha256:")
        .ok_or_else(|| format!("GitHub published an unsupported digest for {}.", asset.name))?;
    if sha256.len() != 64
        || !sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(format!(
            "GitHub published an invalid SHA-256 digest for {}.",
            asset.name
        ));
    }
    Ok(sha256)
}

fn validate_asset_url(asset: &PublishedAsset) -> Result<(), String> {
    let url = net::validate_url_for(&asset.browser_download_url, RemoteSource::GitHubRelease)?;
    if !url
        .path()
        .starts_with("/mastercomfig/mastercomfig/releases/download/")
        || url.path_segments().and_then(Iterator::last) != Some(asset.name.as_str())
    {
        return Err(format!(
            "GitHub returned an unexpected download URL for {}.",
            asset.name
        ));
    }
    Ok(())
}

fn fetch_latest_release() -> Result<PublishedRelease, String> {
    net::get_json_for(&net::api_client()?, RELEASE_URL, RemoteSource::GitHubApi).map_err(|err| {
        if err.starts_with("Could not read") {
            "Could not read the official mastercomfig release.".to_string()
        } else {
            err
        }
    })
}

pub fn fetch_wizard_assets(spec: &WizardSpec) -> Result<Vec<(String, Vec<u8>)>, String> {
    let release = fetch_latest_release()?;
    let urls = download_urls_for_spec(spec, &release.core_shape())?;
    fetch_all(release.selected(urls)?)
}

pub fn fetch_official_assets(rel_paths: &[String]) -> Result<Vec<(String, Vec<u8>)>, String> {
    let release = fetch_latest_release()?;
    let urls = execs_core::official_download_urls(rel_paths, &release.core_shape())?;
    fetch_all(release.selected(urls)?)
}

fn fetch_all(selected: Vec<SelectedAsset>) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut assets = Vec::with_capacity(selected.len());
    for asset in selected {
        let bytes =
            net::download_bytes_for(&asset.url, VPK_MAX_BYTES, RemoteSource::GitHubRelease)?;
        verify_asset_bytes(&asset, &bytes)?;
        assets.push((asset.rel, bytes));
    }
    Ok(assets)
}

fn verify_asset_bytes(asset: &SelectedAsset, bytes: &[u8]) -> Result<(), String> {
    if execs_core::hash::sha256_hex(bytes) != asset.sha256 {
        return Err(format!("{} failed SHA-256 verification.", asset.rel));
    }
    if !valid_vpk(bytes) {
        return Err(format!("{} is not a valid VPK.", asset.rel));
    }
    Ok(())
}

fn valid_vpk(bytes: &[u8]) -> bool {
    let Some(header) = bytes.get(..12) else {
        return false;
    };
    if header[..4] != [0x34, 0x12, 0xaa, 0x55] {
        return false;
    }
    let version = u32::from_le_bytes(header[4..8].try_into().unwrap());
    let header_len = match version {
        1 => 12usize,
        2 => 28,
        _ => return false,
    };
    let tree_len = u32::from_le_bytes(header[8..12].try_into().unwrap()) as usize;
    bytes.len() >= header_len && tree_len <= bytes.len() - header_len
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(digest: Option<&str>) -> PublishedAsset {
        PublishedAsset {
            name: "mastercomfig-base.vpk".into(),
            browser_download_url: "https://github.com/mastercomfig/mastercomfig/releases/download/9.100.1/mastercomfig-base.vpk".into(),
            digest: digest.map(str::to_string),
        }
    }

    #[test]
    fn release_assets_require_githubs_sha256_digest_and_canonical_url() {
        let good = format!("sha256:{}", "a".repeat(64));
        assert_eq!(
            published_sha256(&asset(Some(&good))).unwrap(),
            "a".repeat(64)
        );
        assert!(published_sha256(&asset(None)).is_err());
        assert!(published_sha256(&asset(Some("sha256:abcd"))).is_err());
        assert!(published_sha256(&asset(Some(&format!("sha512:{}", "a".repeat(64))))).is_err());
        assert!(validate_asset_url(&asset(Some(&good))).is_ok());

        let mut wrong = asset(Some(&good));
        wrong.browser_download_url =
            "https://github.com/attacker/repo/releases/download/v1/mastercomfig-base.vpk".into();
        assert!(validate_asset_url(&wrong).is_err());
    }

    #[test]
    fn downloaded_vpk_must_match_the_published_digest_and_parse_as_a_vpk_header() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&[0x34, 0x12, 0xaa, 0x55]);
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        let selected = SelectedAsset {
            rel: "tf/custom/mastercomfig-base.vpk".into(),
            url: String::new(),
            sha256: execs_core::hash::sha256_hex(&bytes),
        };
        assert!(verify_asset_bytes(&selected, &bytes).is_ok());
        assert!(verify_asset_bytes(&selected, b"not a vpk").is_err());

        let mut wrong_hash = selected;
        wrong_hash.sha256 = "0".repeat(64);
        assert!(verify_asset_bytes(&wrong_hash, &bytes).is_err());
    }

    #[test]
    #[ignore = "live network regression"]
    fn live_release_metadata_publishes_sha256_for_every_vpk() {
        let release = fetch_latest_release().unwrap();
        let vpks: Vec<_> = release
            .assets
            .iter()
            .filter(|asset| asset.name.ends_with(".vpk"))
            .collect();
        assert!(!vpks.is_empty());
        for asset in vpks {
            published_sha256(asset).unwrap();
            validate_asset_url(asset).unwrap();
        }
    }
}
