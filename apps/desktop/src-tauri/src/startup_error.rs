//! Native failure reporting before the webview or any background writer starts.

use std::path::Path;

pub(crate) fn description(error: &str, state_path: Option<&Path>, version: &str) -> String {
    let state = state_path
        .map(execs_core::finder::user_path_string)
        .unwrap_or_else(|| "Unavailable: the app data directory could not be resolved.".into());
    format!(
        "execs stopped before opening to protect your TF2 installation.\n\n\
         execs {version}\n\
         State location: {state}\n\n\
         {error}\n\n\
         No recovery markers were cleared and no TF2 files were changed.\n\
         Copy this message (Ctrl+C on Windows; select the text and copy on Linux) \
         and include it in a bug report at:\n\
         https://github.com/rndaom/execs/issues/new/choose\n\n\
         Keep the state files in place so the interrupted operation can be reviewed."
    )
}

pub(crate) fn show(error: &str, state_path: Option<&Path>) {
    let text = description(error, state_path, env!("CARGO_PKG_VERSION"));
    eprintln!("{text}");
    // In a headless Linux session GTK may not be able to open a dialog. Keep
    // stderr as the fallback, with exactly the same diagnostic and no writes.
    let _ = std::panic::catch_unwind(|| {
        rfd::MessageDialog::new()
            .set_title("execs could not start")
            .set_description(text)
            .set_level(rfd::MessageLevel::Error)
            .set_buttons(rfd::MessageButtons::Ok)
            .show();
    });
}

#[cfg(test)]
mod tests {
    use super::description;
    use std::path::Path;

    #[test]
    fn includes_full_revision_path_and_safe_recovery_guidance() {
        let text = description(
            "found invalid maintenance state",
            Some(Path::new("state/maintenance")),
            "0.2.0+3",
        );
        for expected in [
            "0.2.0+3",
            "state",
            "maintenance",
            "found invalid maintenance state",
            "No recovery markers were cleared",
            "Ctrl+C",
            "issues/new/choose",
            "Keep the state files",
        ] {
            assert!(text.contains(expected), "missing {expected}: {text}");
        }
    }

    #[test]
    fn missing_data_directory_still_gives_an_actionable_diagnostic() {
        let text = description("APPDATA is unset", None, "0.2.0");
        assert!(text.contains("Unavailable: the app data directory could not be resolved."));
        assert!(text.contains("APPDATA is unset"));
        assert!(text.contains("protect your TF2 installation"));
    }
}
