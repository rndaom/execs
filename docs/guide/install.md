# Installing and removing execs

Download execs only from the [latest release](https://github.com/rndaom/execs/releases/latest) on this repository. That published build is the only supported install. Updates are offered inside the app and install only when you click.

## Windows

Windows 10 or 11, 64-bit. Run the `-setup.exe`. It installs for your user account, so no administrator rights are needed.

The installer doesn't carry a publisher signature yet, so Windows SmartScreen or your browser may warn about it, often again for each new version. If the file came from this repository's releases page, choose **More info** → **Run anyway**. Work or school PCs may block unsigned apps entirely; follow your organisation's rules there.

### Checking the download

To make sure the file is exactly the one published, compare its SHA-256 digest with the one GitHub shows next to the file on the release page. In PowerShell:

```powershell
Get-FileHash -Algorithm SHA256 .\execs_*_x64-setup.exe
```

A matching digest proves the bytes are the released ones. It doesn't prove who signed them, since the installer isn't signed.

When you install over an older version, the installer asks whether to uninstall the old one first. Keep **Uninstall before installing**, and leave **Delete the application data** unticked. Your profiles are never in the program folder, so they stay either way.

## Linux

x86_64 with glibc 2.35 or newer (Ubuntu 22.04, Debian 12, Fedora 36 or later).

- **AppImage:** make it executable and keep it in a folder you own, such as `~/Applications`, so updates can replace it.
- **`.deb`:** installs normally, but doesn't update itself; install each new version from the release page.

## First launch

execs finds TF2 through Steam and asks you to confirm the folder before writing anything. If TF2 already has your own files, execs saves them as your first profile. Otherwise it helps you set one up.

## Where execs keeps things

| | Windows | Linux |
|---|---|---|
| Profiles, settings, downloads | `%AppData%\execs` | `~/.local/share/execs` |
| Backups of patched game files | `…\execs\preloader\originals` | `…/execs/preloader/originals` |
| Crash log | `…\execs\logs\panic.log` | `…/execs/logs/panic.log` |

## Removing execs

Open **App settings → Uninstall**. Your current TF2 setup stays installed: cfgs, HUD and custom files stay in TF2. If Casual setup changed TF2's own files, use **Restore stock files** there first. Deleting your profiles and other execs data is a separate choice.

On Windows the uninstaller opens. An AppImage deletes itself. A `.deb` install shows the `apt remove` command to run. If the game looks wrong afterwards, verify TF2's files in Steam.

## Troubleshooting

- **Blank window on Linux with NVIDIA:** start execs with `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
- **AppImage won't start:** run it with `--appimage-extract-and-run`.
- **A crash:** the crash log is listed above. Remove personal details before attaching it to a public bug report.
