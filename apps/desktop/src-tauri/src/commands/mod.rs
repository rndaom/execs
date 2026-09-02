//! The IPC surface, split by the core module each group delegates to.

pub mod absorb;
pub mod comfig;
pub mod crosshair;
pub mod diagnostics;
pub mod files;
pub mod finder;
pub mod first_run;
pub mod hitsound;
pub mod hud;
pub mod launch;
pub mod library;
pub mod preloader;
pub mod shared;
pub mod viewmodel;

use tauri::{AppHandle, Manager};

use crate::error::CommandError;

/// In-app windows for mastercomfig web surfaces. The pages are remote content
/// and get no Tauri IPC (they are never added to any capability).
#[tauri::command]
pub async fn open_embedded_page(app: AppHandle, page: String) -> Result<(), CommandError> {
    let (label, url, title) = match page.as_str() {
        "comfig-extras" => (
            "comfig-extras",
            "https://comfig.app/app/",
            "mastercomfig extras",
        ),
        "comfig-docs" => (
            "comfig-docs",
            "https://docs.comfig.app/latest/",
            "mastercomfig preset guide",
        ),
        _ => return Err(CommandError::unknown("Unknown embedded page.")),
    };
    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }
    let url: tauri::Url = url
        .parse()
        .map_err(|_| CommandError::unknown("Invalid URL."))?;
    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::External(url))
        .title(title)
        .inner_size(1160.0, 820.0)
        .background_color(tauri::window::Color(18, 18, 18, 255))
        // The window has no IPC, but without this a link on comfig.app could
        // still navigate our chrome anywhere on the web. Off-site links belong
        // in the user's own browser.
        .on_navigation(|url| embedded_host_allowed(url.host_str()))
        .build()
        .map_err(|err| CommandError::unknown(err.to_string()))?;
    Ok(())
}

/// The only hosts the embedded mastercomfig windows may navigate to.
fn embedded_host_allowed(host: Option<&str>) -> bool {
    matches!(host, Some("comfig.app") | Some("docs.comfig.app"))
}

#[cfg(test)]
mod tests {
    use super::embedded_host_allowed;

    #[test]
    fn only_the_two_comfig_hosts_are_navigable() {
        assert!(embedded_host_allowed(Some("comfig.app")));
        assert!(embedded_host_allowed(Some("docs.comfig.app")));
        assert!(!embedded_host_allowed(Some("evil.comfig.app.example.com")));
        assert!(!embedded_host_allowed(Some("comfig.app.evil.test")));
        assert!(!embedded_host_allowed(Some("github.com")));
        assert!(!embedded_host_allowed(None));
    }
}
