<p align="center">
  <img src="docs/media/icon.png" width="96" alt="">
</p>

<h1 align="center">execs</h1>

<p align="center">Your Team Fortress 2 setup as profiles. Switch in one click.</p>

<p align="center">
  <a href="https://github.com/rndaom/execs/releases/latest"><b>Download</b></a> ·
  <a href="#install">Install</a> ·
  <a href="#files">Files</a> ·
  <a href="#bugs">Bugs</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

![An overview of execs](docs/media/promo.gif)

The demo and screenshots show an earlier release with sample data. The current download has updated controls and layouts; these images do not preview unreleased features.

## What it does

A profile is everything that makes your install yours: config, binds, HUD, crosshair, viewmodels, sounds, launch options. execs keeps profiles outside the game folder and writes the active one into `tf/custom/` and the player cfg layer: `tf/cfg/overrides/` with mastercomfig, or user files in `tf/cfg/` without it. Profiles also preserve `config.cfg` and its local Steam Cloud copy. These game files stay locked while TF2 runs. Changes made in-game flow back into the profile when the game closes.

- **Comfig.** [mastercomfig](https://comfig.app) presets, modules, addons.
- **Binds.** Click an action, press a key.
- **HUD.** Install from the hud-db catalog, tune its options, or import your own.
- **Crosshair.** Stock, 173 community crosshairs, or your own design per weapon.
- **Viewmodels.** Hide weapons per class, compiled with the game's own tools on Windows. Linux supports importing prebuilt packs.
- **Sounds.** Hit and kill sounds from a library, or your own WAV.
- **Mods.** Bring your own packs, or browse GameBanana. Optional Casual preloading supports selected customizations; server rules and TF2 updates can limit what appears. **Restore stock files** reverses its gameinfo and stock-particle changes. Compatibility is not guaranteed for every mod.
- **Files.** Edit your own UTF-8 cfgs with a Source-aware linter; inspect provided cfgs read-only.

<p align="center">
  <img src="docs/media/hud.png" width="49%" alt="HUD pane">
  <img src="docs/media/crosshair.png" width="49%" alt="Crosshair pane">
</p>
<p align="center">
  <img src="docs/media/mods.png" width="49%" alt="Mods pane">
  <img src="docs/media/sounds.png" width="49%" alt="Sounds pane">
</p>

## Install

Download from the [latest release](https://github.com/rndaom/execs/releases/latest). That published build is the only supported install; updates are offered in-app and install only when you click. What changed: [changelog](CHANGELOG.md).

**Windows 10 or 11, 64-bit.** Run the `-setup.exe`. It installs per user, no admin needed. The installer does not have an Authenticode publisher signature yet. Windows or your browser may warn on each new version; [SmartScreen reputation is specific to the file and publisher](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

![Example Windows SmartScreen warning](docs/media/smartscreen.png)

Before proceeding, confirm that the download comes from the published `rndaom/execs` GitHub release, that its name and version match, and that its SHA-256 digest matches the release. PowerShell's `Get-FileHash -Algorithm SHA256 .\downloaded-setup.exe` can check the downloaded file. An unsigned installer has no verified publisher identity; a matching digest checks the release bytes, not publisher signing.

If you trust that verified source and your device policy allows it, SmartScreen may offer **More info** → **Run anyway**. Do not dismiss a browser warning without checking its reason and the source. Managed devices may prohibit unsigned apps; follow your organization's policy.

**Linux, x86_64.** The AppImage needs glibc 2.35+ (Ubuntu 22.04, Debian 12, Fedora 36 or newer). Make it executable and keep it in a folder you own, such as `~/Applications`, so updates can replace it. The `.deb` works too but does not self-update.

On first launch execs finds TF2 through Steam and asks you to confirm the folder. If you already have custom files, it offers to save them as your first profile.

## Files

| | Windows | Linux |
|---|---|---|
| Profiles, settings, caches | `%AppData%\execs` | `~/.local/share/execs` |
| Backups of patched game files | `…\execs\preloader\originals` | `…/execs/preloader/originals` |
| Crash log | `…\execs\logs\panic.log` | `…/execs/logs/panic.log` |

To remove execs, in this order:

1. Mods pane, **Restore stock files**.
2. Uninstall the app.
3. Delete the execs folder. This deletes your profiles.

If the game looks wrong afterwards, verify game files in Steam.

**Troubleshooting**

- Blank window on Linux with NVIDIA: run with `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
- AppImage will not start: run it with `--appimage-extract-and-run`.
- Crash: review and redact personal details in the crash log before attaching it to a public bug report.

## Bugs

[Open an issue](https://github.com/rndaom/execs/issues/new/choose). The footer of the app has **Report a bug** and **Copy diagnostics**; review copied diagnostics for personal details before posting them. Questions go in [Discussions](https://github.com/rndaom/execs/discussions). A vulnerability that could write the wrong file belongs in [SECURITY.md](SECURITY.md), not a public issue.

## Credits

execs installs work by the TF2 community:

- [mastercomfig](https://github.com/mastercomfig/mastercomfig) and [hud-db](https://github.com/mastercomfig/hud-db) by [mastercoms](https://github.com/mastercoms)
- [TF2HUD.Editor](https://github.com/CriticalFlaw/TF2HUD.Editor) by [CriticalFlaw](https://github.com/CriticalFlaw)
- [CompVMInstaller](https://github.com/Yttrium-tYcLief/CompVMInstaller) by [Yttrium](https://github.com/Yttrium-tYcLief), previews by Oblique
- [casual-pre-loader](https://github.com/cueki/casual-pre-loader) by [cueki](https://github.com/cueki)
- [Flat Textures (2021)](https://gamebanana.com/mods/295065) by [flewvar](https://gamebanana.com/members/1764119), with textures credited to [JarateKing](https://github.com/JarateKing)
- [Venom Crosshairs](https://github.com/hbivnm/Venom-Crosshairs) by [HbiVnm](https://github.com/hbivnm) and the [list](https://github.com/hbivnm/Venom-Crosshairs-List) contributors
- [TF2Hitsounds](https://github.com/WishingStardust/TF2Hitsounds) by [WishingStardust](https://github.com/WishingStardust)
- the [comfig.app hit sounds](https://comfig.app/app/?page=hits) uploaded by their makers

Licenses and how each one is used: [THIRD_PARTY.md](THIRD_PARTY.md).

The inventory organizer under development is inspired by
[Jengerer's Item Manager](https://www.jengerer.com/item_manager/), by Jengerer
and its contributors. It is not available in a public release yet.

Fan project, not affiliated with Valve Corporation. Team Fortress and Steam are trademarks of Valve Corporation.

[Contributing](CONTRIBUTING.md) · [Releases](docs/RELEASE.md) · [Security](SECURITY.md) · [MIT license](LICENSE)
