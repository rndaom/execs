//! The IPC surface, split by the core module each group delegates to.

pub mod absorb;
pub mod app_settings;
pub mod comfig;
pub mod crosshair;
pub mod diagnostics;
pub mod files;
pub mod finder;
pub mod first_run;
pub mod hitsound;
pub mod hud;
pub mod inventory;
pub mod launch;
pub mod library;
pub mod lifecycle;
pub mod mods;
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
        // The window has no IPC, but remote pages still need an exact
        // navigation boundary. Separate window requests are denied below.
        .on_navigation(embedded_url_allowed)
        // Tauri treats window.open/target=_blank as a separate request, not a
        // navigation in this webview. Remote pages must not create another
        // app webview with its own URL and navigation policy.
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()
        .map_err(|err| CommandError::unknown(err.to_string()))?;
    Ok(())
}

/// The only destinations the embedded mastercomfig windows may navigate to.
fn embedded_url_allowed(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && matches!(url.host_str(), Some("comfig.app") | Some("docs.comfig.app"))
}

#[cfg(test)]
mod tests {
    use super::embedded_url_allowed;

    #[test]
    fn only_https_on_the_two_comfig_hosts_is_navigable() {
        for url in ["https://comfig.app/app/", "https://docs.comfig.app/latest/"] {
            assert!(embedded_url_allowed(&url.parse().unwrap()));
        }
        for url in [
            "http://comfig.app/app/",
            "https://comfig.app:444/app/",
            "https://user@comfig.app/app/",
            "https://evil.comfig.app.example.com/",
            "https://comfig.app.evil.test/",
            "https://github.com/",
            "file:///tmp/page.html",
        ] {
            assert!(!embedded_url_allowed(&url.parse().unwrap()), "{url}");
        }
    }
}
