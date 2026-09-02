# Third-party content and credits

execs is a first-party app, but most of what it installs comes from the TF2
community. This file lists every outside project the app depends on, how it is
used, and its license. Nothing below is redistributed from this repository
unless the row says so; everything else is downloaded from the original source
on the user's machine, pinned to a specific release or commit.

## Content the app installs or shows

| Project | How execs uses it | License |
|---|---|---|
| [mastercomfig](https://github.com/mastercomfig/mastercomfig) by mastercoms · [comfig.app](https://comfig.app) | Official release VPKs are downloaded at install time. Preset and module semantics come from its documentation. The Comfig pane opens comfig.app pages in an in-app window. | MIT |
| [comfig-app](https://github.com/mastercomfig/comfig-app) | The seven preset preview screenshots in `apps/desktop/src/assets/presets/` are its koth_sawmill captures, re-encoded. The hit sound index (`src/ssg/hitsounds.json`) is fetched pinned; sounds are streamed from `hits.comfig.app` and belong to their uploaders. | MIT |
| [hud-db](https://github.com/mastercomfig/hud-db) | The HUD catalog, banners and screenshots. | MIT |
| [TF2HUD.Editor](https://github.com/CriticalFlaw/TF2HUD.Editor) by CriticalFlaw | HUD option schemas are consumed as data. The apply logic is first-party. | MIT |
| [CompVMInstaller](https://github.com/Yttrium-tYcLief/CompVMInstaller) by Yttrium, previews by Oblique | `animations.zip` and the per-option preview images are downloaded pinned and compiled on the user's machine with TF2's own studiomdl. The group table in `core/src/viewmodel_groups.rs` mirrors its option list. | No license file upstream. Used with attribution; contact the author to have it removed. |
| [casual-pre-loader](https://github.com/cueki/casual-pre-loader) by cueki | The preload mechanism (gameinfo toggle, in-place particle patches) was re-implemented in Rust from observed behaviour; no upstream code is included. The default mod library (`mods.zip`, pinned and checksummed) is downloaded on demand. | GPL-3.0 (upstream tool); mods belong to their authors |
| [Venom Crosshairs](https://github.com/hbivnm/Venom-Crosshairs) and the [community list](https://github.com/hbivnm/Venom-Crosshairs-List) by HbiVnm and contributors | 173 crosshair textures are downloaded pinned and written unchanged into the user's pack. | Tool GPL-3.0; list unlicensed, crosshairs belong to their authors |
| [TF2Hitsounds](https://github.com/WishingStardust/TF2Hitsounds) by WishingStardust | 32 community hit sounds downloaded pinned. | Unlicensed; sounds belong to their authors |
| [mastercomfig cvar reference](https://github.com/mastercomfig/mastercomfig/tree/release/docs/tf2) | `packages/cfglint/src/cvars.gen.ts` is generated from `cvarlist_win.md` and `hiddencvars.md`. | MIT |
| ICE cipher by Matthew Kwan | `core/src/ice.rs` is a port of the reference implementation, used to read weapon scripts from the user's own game files. | Public domain |

The Mods pane browses and downloads from [GameBanana](https://gamebanana.com) through its public API; each mod
belongs to its author. The app also talks to GameBanana, teamfortress.tv and Dropbox to resolve HUD
downloads linked from hud-db, links out to authors' imgur albums, and reads download and view
counts from [tf2huds.dev](https://tf2huds.dev). Nothing from those hosts is
redistributed.

## Fonts and icons

- [Inter](https://rsms.me/inter/) by Rasmus Andersson, via `@fontsource/inter`. SIL Open Font License 1.1.
- [Phosphor Icons](https://phosphoricons.com/). MIT.

## Libraries

Runtime dependencies are listed in `apps/desktop/package.json` and
`apps/desktop/src-tauri/Cargo.toml`. All of them are under permissive licenses
(MIT, Apache-2.0, BSD, ISC, Zlib, Unicode, MPL-2.0 for a few unmodified
crates). Linux builds link against the system's GTK and WebKitGTK.

## Valve

Team Fortress 2, Steam and their file formats belong to Valve Corporation.
execs reads sprites, sounds and weapon scripts from the user's own install and
never redistributes them. execs is a fan project and is not affiliated with
Valve.
