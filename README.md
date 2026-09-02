<p align="center">
  <img src="docs/media/icon.png" width="96" alt="">
</p>

<h1 align="center">execs</h1>

<p align="center">A desktop companion for Team Fortress 2. Your whole setup as named profiles.</p>

<p align="center">
  <a href="https://github.com/rndaom/execs/releases/latest"><b>Download</b></a> ·
  <a href="#what-it-does">What it does</a> ·
  <a href="#install">Install</a> ·
  <a href="#where-things-live">Where things live</a> ·
  <a href="#bugs-and-questions">Bugs</a>
</p>

![The Comfig pane](docs/media/comfig.png)

## What it does

execs saves everything that makes your TF2 install yours (config, binds, HUD, crosshair, viewmodels, sounds, launch options) as a **profile**, and switches between profiles in one click. It replaces the folder-juggling with one app.

- **Comfig.** [mastercomfig](https://comfig.app) presets, modules and official addons, installed from mastercomfig's own releases.
- **Binds.** Click an action, press a key.
- **HUD.** Browse the hud-db catalog, install one HUD per profile, adjust the options popular HUDs expose, or import your own.
- **Crosshair.** Stock crosshairs with a live preview, a community pack of 173 crosshairs, or design your own and assign it per weapon.
- **Viewmodels.** Hide weapon groups per class, built with the game's own compiler. Hover an option to see what it changes.
- **Sounds.** Hit and kill sounds from a searchable library, or your own WAV.
- **Mods.** A casual preload that keeps custom particles and materials alive on Valve servers, with one-click restore of stock files.
- **Files.** Edit any cfg by hand with a linter that knows the engine.

Profiles live outside the game folder. Switching writes exactly the active profile into `tf/custom/` and `tf/cfg/overrides/` (or the vanilla cfg files if you do not use mastercomfig), keeps `config.cfg` in sync with Steam Cloud, and never writes anything while TF2 is running. Changes you make in-game are absorbed back into the active profile when the game closes.

<p align="center">
  <img src="docs/media/hud.png" width="49%" alt="The HUD pane">
  <img src="docs/media/crosshair.png" width="49%" alt="The Crosshair pane">
</p>
<p align="center">
  <img src="docs/media/mods.png" width="49%" alt="The Mods pane">
  <img src="docs/media/sounds.png" width="49%" alt="The Sounds pane">
</p>

## Install

Grab the file for your platform from the [latest release](https://github.com/rndaom/execs/releases/latest). The app checks for updates when it starts and installs them only when you click Install.

**Windows 10 (1803 or later) or Windows 11, 64-bit.** Run `execs_x.y.z_x64-setup.exe`. It installs per user into `%LocalAppData%\execs` and needs no admin rights. The installer is not code-signed yet, so SmartScreen shows "Windows protected your PC" the first time: click *More info*, then *Run anyway*. Your browser may also ask you to *Keep* the download. If WebView2 is missing (rare), the installer downloads it, so stay online during install.

**Linux, x86_64.** `execs_x.y.z_amd64.AppImage` needs glibc 2.35 or newer (Ubuntu 22.04, Debian 12, Fedora 36 and later). Make it executable and keep it somewhere you can write to, such as `~/Applications`, because updates rewrite the file in place. Everything else is bundled. Debian and Ubuntu users can install the `.deb` instead, which does not self-update.

execs finds TF2 through Steam's library folders on first launch and asks you to confirm the folder before writing anything. Steam installed through Flatpak is detected; for Snap, point *Browse* at the folder. If you already have custom files, the first thing it offers is to save them as a profile.

## Where things live

| | Windows | Linux |
|---|---|---|
| Settings, profiles, caches | `%AppData%\execs` | `~/.local/share/execs` |
| Original game bytes the Mods pane patched | `%AppData%\execs\preloader\originals` | `~/.local/share/execs/preloader/originals` |
| Crash log | `%AppData%\execs\logs\panic.log` | `~/.local/share/execs/logs/panic.log` |

To remove execs completely, in this order:

1. On the Mods pane, click *Restore stock files*. This puts back the game files it patched; the snapshots it restores from live in the execs folder, so do this before deleting anything.
2. Delete the profile's packs from `tf/custom/` (they start with `execs-`) and `execs_*.cfg` from `tf/cfg/overrides/`, or leave them if you like the setup.
3. Uninstall the app (Windows: Settings, Apps; Linux: delete the AppImage or `apt remove execs`).
4. Delete the execs folder from the table above. This deletes your profile library.

If the game still looks wrong afterwards, verify the game files in Steam.

## Troubleshooting

- **Blank or white window on Linux with an NVIDIA GPU.** Run with `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
- **The AppImage does not start in a container or minimal distro.** Run it with `--appimage-extract-and-run`.
- **TF2 through Proton on Linux.** execs watches for the native `tf_linux64` and for `tf_win64.exe`, so the write lock covers both.
- **The app crashed.** The crash log path is in the table above; attach it to the bug report.

## Bugs and questions

Open a [bug report](https://github.com/rndaom/execs/issues/new/choose) with your execs version, OS, and what happened. There is also a *Report a bug* link in the app's footer. Questions and ideas go in [Discussions](https://github.com/rndaom/execs/discussions).

## Credits

execs installs content made by the TF2 community: mastercomfig and hud-db by mastercoms, TF2HUD.Editor by CriticalFlaw, CompVMInstaller by Yttrium, casual-pre-loader by cueki, Venom Crosshairs by HbiVnm, TF2Hitsounds by WishingStardust, and the sounds and crosshairs their contributors made. Every source is linked in the app and listed in [THIRD_PARTY.md](THIRD_PARTY.md).

execs is a fan project and is not affiliated with Valve Corporation. Team Fortress and Steam are trademarks of Valve Corporation.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [MIT](LICENSE).
