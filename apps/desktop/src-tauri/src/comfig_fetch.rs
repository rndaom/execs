//! Fetch official mastercomfig GitHub Release VPKs. Core stays network-free.

use execs_core::{download_urls_for_spec, WizardSpec};

const RELEASE_URL: &str = "https://api.github.com/repos/mastercomfig/mastercomfig/releases/latest";
const USER_AGENT: &str = "execs";

pub fn fetch_latest_release() -> Result<execs_core::GitHubRelease, String> {
    let response = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|err| err.to_string())?
        .get(RELEASE_URL)
        .send()
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Could not read the official mastercomfig release ({})",
            response.status()
        ));
    }
    response.json().map_err(|err| err.to_string())
}

pub fn download_bytes(url: &str) -> Result<Vec<u8>, String> {
    let response = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        // A stalled connection must fail instead of pinning the UI's busy
        // state forever. Ten minutes covers the 81 MB mod library on slow
        // links; everything else we fetch is far smaller.
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|err| err.to_string())?
        .get(url)
        .send()
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Could not download {url} ({})", response.status()));
    }
    response
        .bytes()
        .map(|bytes| bytes.to_vec())
        .map_err(|err| err.to_string())
}

pub fn fetch_wizard_assets(spec: &WizardSpec) -> Result<Vec<(String, Vec<u8>)>, String> {
    let release = fetch_latest_release()?;
    let urls = download_urls_for_spec(spec, &release)?;
    let mut assets = Vec::new();
    for (rel, url) in urls {
        assets.push((rel, download_bytes(&url)?));
    }
    Ok(assets)
}

pub fn fetch_official_assets(rel_paths: &[String]) -> Result<Vec<(String, Vec<u8>)>, String> {
    let release = fetch_latest_release()?;
    let urls = execs_core::official_download_urls(rel_paths, &release)?;
    let mut assets = Vec::new();
    for (rel, url) in urls {
        assets.push((rel, download_bytes(&url)?));
    }
    Ok(assets)
}
