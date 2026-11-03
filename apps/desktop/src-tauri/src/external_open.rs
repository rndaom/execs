//! Hand a URL to the desktop's default handler (Steam for `steam://`, the
//! browser for `https://`).
//!
//! The AppImage runtime points `PATH`, `LD_LIBRARY_PATH`, `PYTHONHOME`, the
//! GTK/GStreamer/Qt module paths and more at the mounted image. A program
//! started from execs inherits them and loads execs's bundled libraries and
//! modules instead of its own: a Steam started this way runs Proton with
//! execs's `PYTHONHOME`, Proton cannot start Python, and every Proton game
//! exits as soon as it is launched. Inside an AppImage the opener therefore
//! runs with every reference to the mounted image removed from its
//! environment.

/// Open `url` with the default handler, without waiting for it.
pub fn open_url(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "linux")]
    if let Some(appdir) = appimage::mount_dir() {
        return appimage::open_url(url, &appdir);
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(std::io::Error::other)
}

#[cfg(target_os = "linux")]
mod appimage {
    use std::ffi::{OsStr, OsString};
    use std::io;
    use std::os::unix::ffi::{OsStrExt, OsStringExt};
    use std::os::unix::process::CommandExt;
    use std::path::{Path, PathBuf};
    use std::process::Stdio;

    /// Variables the AppImage runtime sets only to describe itself.
    const RUNTIME_ONLY: &[&str] = &["APPDIR", "APPIMAGE", "ARGV0", "OWD"];

    /// The mounted image this process runs from, or `None` outside an AppImage.
    pub(super) fn mount_dir() -> Option<PathBuf> {
        let appdir = PathBuf::from(std::env::var_os("APPDIR")?);
        (appdir.is_absolute() && appdir.parent().is_some()).then_some(appdir)
    }

    /// Try each opener the `open` crate knows, in its order, like
    /// `open::that_detached`, but with the host's environment.
    pub(super) fn open_url(url: &str, appdir: &Path) -> io::Result<()> {
        let changes = host_environment(std::env::vars_os(), appdir);
        let mut last_error = None;
        for mut command in open::commands(url) {
            for (key, value) in &changes {
                match value {
                    Some(value) => command.env(key, value),
                    None => command.env_remove(key),
                };
            }
            command
                .current_dir("/")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                // Off execs's process group, so closing execs from a terminal
                // does not signal Steam or the browser.
                .process_group(0);
            match command.spawn() {
                Ok(mut child) => {
                    // xdg-open can keep running as long as the program it
                    // started; reap it whenever it exits.
                    std::thread::spawn(move || {
                        let _ = child.wait();
                    });
                    return Ok(());
                }
                Err(error) => last_error = Some(error),
            }
        }
        Err(last_error.unwrap_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no URL opener")))
    }

    /// The changes that turn this process's environment back into the host's:
    /// `Some` sets a variable to a value with the image's entries dropped,
    /// `None` removes it. Variables that never mention the image are left out.
    pub(super) fn host_environment(
        vars: impl IntoIterator<Item = (OsString, OsString)>,
        appdir: &Path,
    ) -> Vec<(OsString, Option<OsString>)> {
        let appdir = appdir.as_os_str().as_bytes();
        let appdir = appdir.strip_suffix(b"/").unwrap_or(appdir);
        vars.into_iter()
            .filter_map(|(key, value)| {
                if RUNTIME_ONLY.iter().any(|name| key == OsStr::new(name)) {
                    return Some((key, None));
                }
                let bytes = value.as_bytes();
                if !bytes.windows(appdir.len()).any(|window| window == appdir) {
                    return None;
                }
                let kept: Vec<&[u8]> = bytes
                    .split(|&b| b == b':')
                    .filter(|entry| !entry.is_empty() && !under(entry, appdir))
                    .collect();
                let value = (!kept.is_empty()).then(|| OsString::from_vec(kept.join(&b':')));
                Some((key, value))
            })
            .collect()
    }

    fn under(entry: &[u8], appdir: &[u8]) -> bool {
        entry
            .strip_prefix(appdir)
            .is_some_and(|rest| rest.is_empty() || rest[0] == b'/')
    }

    #[cfg(test)]
    mod tests {
        use super::host_environment;
        use std::ffi::OsString;
        use std::path::Path;

        fn changes(vars: &[(&str, &str)]) -> Vec<(String, Option<String>)> {
            let vars = vars
                .iter()
                .map(|(k, v)| (OsString::from(k), OsString::from(v)));
            host_environment(vars, Path::new("/tmp/.mount_execs.aB12"))
                .into_iter()
                .map(|(k, v)| {
                    (
                        k.into_string().unwrap(),
                        v.map(|v| v.into_string().unwrap()),
                    )
                })
                .collect()
        }

        #[test]
        fn image_entries_are_dropped_from_path_lists() {
            assert_eq!(
                changes(&[
                    ("PATH", "/tmp/.mount_execs.aB12/usr/bin/:/usr/local/bin:/usr/bin"),
                    (
                        "LD_LIBRARY_PATH",
                        "/home/u/.steam/ubuntu12_32:/tmp/.mount_execs.aB12//usr/lib/:/tmp/.mount_execs.aB12/lib64"
                    ),
                    ("XDG_DATA_DIRS", "/tmp/.mount_execs.aB12/usr/share/::/usr/share"),
                ]),
                [
                    ("PATH".into(), Some("/usr/local/bin:/usr/bin".into())),
                    ("LD_LIBRARY_PATH".into(), Some("/home/u/.steam/ubuntu12_32".into())),
                    ("XDG_DATA_DIRS".into(), Some("/usr/share".into())),
                ]
            );
        }

        #[test]
        fn variables_that_only_point_into_the_image_are_removed() {
            assert_eq!(
                changes(&[
                    ("PYTHONHOME", "/tmp/.mount_execs.aB12/usr/"),
                    ("PYTHONPATH", "/tmp/.mount_execs.aB12/usr/share/pyshared/:"),
                    (
                        "GDK_PIXBUF_MODULE_FILE",
                        "/tmp/.mount_execs.aB12//tmp/x/pixbuf/loaders.cache"
                    ),
                    (
                        "GIO_EXTRA_MODULES",
                        "/tmp/.mount_execs.aB12/usr/lib/gio/modules"
                    ),
                ]),
                [
                    ("PYTHONHOME".into(), None),
                    ("PYTHONPATH".into(), None),
                    ("GDK_PIXBUF_MODULE_FILE".into(), None),
                    ("GIO_EXTRA_MODULES".into(), None),
                ]
            );
        }

        #[test]
        fn runtime_variables_are_removed_and_the_rest_left_alone() {
            assert_eq!(
                changes(&[
                    ("APPDIR", "/tmp/.mount_execs.aB12"),
                    ("APPIMAGE", "/home/u/.local/opt/execs/execs.AppImage"),
                    ("OWD", "/home/u"),
                    ("HOME", "/home/u"),
                    ("WAYLAND_DISPLAY", "wayland-1"),
                    ("NOTES", "/tmp/.mount_execs.aB12x/elsewhere"),
                ]),
                [
                    ("APPDIR".into(), None),
                    ("APPIMAGE".into(), None),
                    ("OWD".into(), None),
                    (
                        "NOTES".into(),
                        Some("/tmp/.mount_execs.aB12x/elsewhere".into())
                    ),
                ]
            );
        }
    }
}
