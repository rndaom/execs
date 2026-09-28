//! Fetch official mastercomfig GitHub Release VPKs. Core stays network-free.

use execs_core::comfig::ComfigRelease;
use execs_core::{GitHubAsset, GitHubRelease, WizardSpec};
use serde::Deserialize;

use crate::net::{self, RemoteSource, MIB};

const RELEASE_URL: &str = "https://api.github.com/repos/mastercomfig/mastercomfig/releases/latest";

/// The whole mastercomfig release is a few MB; 256 MiB is a ceiling, not a
/// target.
const VPK_MAX_BYTES: u64 = 256 * MIB;

#[derive(Debug, Deserialize)]
struct PublishedRelease {
    tag_name: String,
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
    fn verify_installed(&self, installed: &ComfigRelease) -> Result<(), String> {
        if self.tag_name != installed.version {
            return Err("GitHub returned a different mastercomfig release.".into());
        }
        let paths = installed.packages.keys().cloned().collect::<Vec<_>>();
        for asset in self.selected(execs_core::official_download_urls(
            &paths,
            &self.core_shape(),
        )?)? {
            if installed.packages.get(&asset.rel) != Some(&asset.sha256) {
                return Err("The installed mastercomfig packages do not match their release. Update packages before adding an addon.".into());
            }
        }
        Ok(())
    }
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
        if !execs_core::comfig::valid_release_version(&self.tag_name) {
            return Err("Official mastercomfig release has an invalid version.".into());
        }
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
                if asset.browser_download_url
                    != format!(
                        "https://github.com/mastercomfig/mastercomfig/releases/download/{}/{}",
                        self.tag_name, asset.name
                    )
                {
                    return Err(format!(
                        "Official mastercomfig package {name} belongs to a different release."
                    ));
                }
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
    net::get_json_for(&net::api_client()?, RELEASE_URL, RemoteSource::GitHubApi)
}

pub fn fetch_wizard_assets(spec: &WizardSpec) -> Result<DownloadedRelease, String> {
    fetch_release_packages(&execs_core::wizard::required_wizard_assets(spec), None)
}

pub struct DownloadedRelease {
    pub files: Vec<(String, Vec<u8>)>,
    pub identity: ComfigRelease,
}

pub fn fetch_release_packages(
    rel_paths: &[String],
    installed: Option<&ComfigRelease>,
) -> Result<DownloadedRelease, String> {
    let release = if let Some(installed) = installed {
        if !execs_core::comfig::valid_release_version(&installed.version) {
            return Err("The installed mastercomfig version is unknown. Update packages before adding an addon.".into());
        }
        let url = format!(
            "https://api.github.com/repos/mastercomfig/mastercomfig/releases/tags/{}",
            installed.version
        );
        let release: PublishedRelease =
            net::get_json_for(&net::api_client()?, &url, RemoteSource::GitHubApi)?;
        release.verify_installed(installed)?;
        release
    } else {
        fetch_latest_release()?
    };
    let selected = release.selected(execs_core::official_download_urls(
        rel_paths,
        &release.core_shape(),
    )?)?;
    let mut packages = installed
        .map(|record| record.packages.clone())
        .unwrap_or_default();
    for asset in &selected {
        packages.insert(asset.rel.clone(), asset.sha256.clone());
    }
    Ok(DownloadedRelease {
        files: fetch_all(selected)?,
        identity: ComfigRelease {
            version: release.tag_name,
            packages,
        },
    })
}

pub fn latest_version() -> Result<String, String> {
    let release = fetch_latest_release()?;
    let paths = vec!["tf/custom/mastercomfig-base.vpk".into()];
    release.selected(execs_core::official_download_urls(
        &paths,
        &release.core_shape(),
    )?)?;
    Ok(release.tag_name)
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
    fn addons_require_the_exact_installed_release_and_all_retained_hashes() {
        let digest = format!("sha256:{}", "a".repeat(64));
        let mut release = PublishedRelease {
            tag_name: "9.100.1".into(),
            assets: vec![asset(Some(&digest))],
        };
        let installed = ComfigRelease {
            version: "9.100.1".into(),
            packages: std::collections::BTreeMap::from([(
                "tf/custom/mastercomfig-base.vpk".into(),
                "a".repeat(64),
            )]),
        };
        assert!(release.verify_installed(&installed).is_ok());
        release.tag_name = "9.100.2".into();
        assert!(release.verify_installed(&installed).is_err());
        release.tag_name = installed.version.clone();
        release.assets[0].digest = Some(format!("sha256:{}", "b".repeat(64)));
        assert!(release.verify_installed(&installed).is_err());
        release.assets[0].digest = Some(digest);
        release.assets[0].browser_download_url = release.assets[0]
            .browser_download_url
            .replace("9.100.1", "9.100.2");
        assert!(release.verify_installed(&installed).is_err());
        assert!(!execs_core::comfig::valid_release_version("../latest"));
        assert!(!execs_core::comfig::valid_release_version("tag?redirect=x"));
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
