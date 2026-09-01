//! Fetch official mastercomfig GitHub Release VPKs. Core stays network-free.

use execs_core::{download_urls_for_spec, WizardSpec};

use crate::net::{self, MIB};

const RELEASE_URL: &str = "https://api.github.com/repos/mastercomfig/mastercomfig/releases/latest";

/// The whole mastercomfig release is a few MB; 256 MiB is a ceiling, not a
/// target.
const VPK_MAX_BYTES: u64 = 256 * MIB;

pub fn fetch_latest_release() -> Result<execs_core::GitHubRelease, String> {
    net::get_json(&net::api_client()?, RELEASE_URL).map_err(|err| {
        if err.starts_with("Could not read") {
            "Could not read the official mastercomfig release.".to_string()
        } else {
            err
        }
    })
}

pub fn fetch_wizard_assets(spec: &WizardSpec) -> Result<Vec<(String, Vec<u8>)>, String> {
    let release = fetch_latest_release()?;
    let urls = download_urls_for_spec(spec, &release)?;
    fetch_all(urls)
}

pub fn fetch_official_assets(rel_paths: &[String]) -> Result<Vec<(String, Vec<u8>)>, String> {
    let release = fetch_latest_release()?;
    let urls = execs_core::official_download_urls(rel_paths, &release)?;
    fetch_all(urls)
}

fn fetch_all(urls: Vec<(String, String)>) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut assets = Vec::with_capacity(urls.len());
    for (rel, url) in urls {
        assets.push((rel, net::download_bytes(&url, VPK_MAX_BYTES)?));
    }
    Ok(assets)
}
