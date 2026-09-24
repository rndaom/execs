# Third-party content and credits

execs installs and displays content from the TF2 community. This file records
the outside projects it uses, how it uses them, and the license or permission
evidence identified for each. This file describes the in-development 0.2.0
branch; the public v0.1.8 release may still offer catalogs retired here. Some
content is shipped in this repository; other content is fetched on the
player's machine under source-specific revision and validation rules. A source
pin is not a rights grant.

## Content the app installs or shows

| Project | How execs uses it | License or permission evidence |
|---|---|---|
| [mastercomfig](https://github.com/mastercomfig/mastercomfig) by mastercoms · [comfig.app](https://comfig.app) | Official release VPKs are downloaded at install time. Preset and module semantics come from its documentation. The Comfig pane opens comfig.app pages in an in-app window. | MIT |
| [comfig-app](https://github.com/mastercomfig/comfig-app) | The seven preset preview screenshots in `apps/desktop/src/assets/presets/` are its koth_sawmill captures, re-encoded. New hosted-sound catalog reads and downloads are retired. Previously installed WAVs remain in profile packs and can still play and be auditioned; execs no longer re-fetches originals to change their baked boost. | MIT for the repository; the captured TF2 imagery and per-upload sound rights require separate assessment. Users should review sharing rights before exporting a profile containing these sounds. See the D7 register below. |
| [hud-db](https://github.com/mastercomfig/hud-db) | The HUD catalog, banners and screenshots; selected HUD imagery also appears in repository promotional captures. | MIT for the repository; HUD authors supply its images, so the promotional image use has a separate D7 review. |
| [TF2HUD.Editor](https://github.com/CriticalFlaw/TF2HUD.Editor) by CriticalFlaw | HUD option schemas are consumed as data. The apply logic is first-party. | MIT |
| [CompVMInstaller](https://github.com/Yttrium-tYcLief/CompVMInstaller) by Yttrium, previews by Oblique | `animations.zip` and the per-option preview images are downloaded pinned and compiled on the user's machine with TF2's own studiomdl. The group table in `core/src/viewmodel_groups.rs` mirrors its option list. | The pinned [About box](https://github.com/Yttrium-tYcLief/CompVMInstaller/blob/b215a5cdfcd809ec3c2d71529e7a1eb22a72a39e/Project/CompVMInstaller/AboutBox1.Designer.vb) identifies the program as GPL-3.0. No separate rights file identifies terms for the animation ZIP or Oblique previews. The [public permission request](https://github.com/Yttrium-tYcLief/CompVMInstaller/issues/5) is open without a reply; the owner confirmed continuation for 0.1.1 on 2026-09-04. See docs/release-0.1.1.md. |
| [casual-pre-loader](https://github.com/cueki/casual-pre-loader) by cueki | The preload mechanism (gameinfo toggle, in-place particle patches) was re-implemented in Rust from observed behaviour; no upstream code is included. The default mod library (`mods.zip`, pinned and checksummed) is downloaded on demand for its other addons and particle selections. | GPL-3.0 for the upstream tool; the archive's mod collections belong to their authors and have no per-collection grant documented here. See the D7 register below. |
| [Flat Textures (2021)](https://gamebanana.com/mods/295065) by flewvar, using textures credited to JarateKing | The original author ZIP is fetched directly from GameBanana when this choice is applied or switched to, pinned by complete-file and loose-payload hashes, and installed into the player's local Casual preload pack. Its saved `Flat Textures v1` selection remains compatible. | The [current author checklist](https://gamebanana.com/apiv11/Mod/295065/LicensePage) allows direct download/install, asks before redistribution or distribution of modified/partial versions, and prohibits commercial use. The [mod credits](https://gamebanana.com/apiv11/Mod/295065/ProfilePage) name JarateKing as the texture source. This direct path does not resolve every underlying right or profile-sharing policy; see the D7 register. |
| [Developer Textures Overhaul v2](https://gamebanana.com/mods/336110), reworked by FPS_Engineer from material reuploaded and continued by ayrtonSilna | The pinned 7z for this rework is fetched directly from GameBanana for the saved Casual choice. Its complete archive, contained VPK and exact 996-file game tree are verified before local packing; Developer-only Apply and switch do not require cueki's library. Profile ZIPs carry the selection without the author archive or generated preload pack. | The [current rework checklist](https://gamebanana.com/apiv11/Mod/336110/LicensePage) allows direct download/install and asks before redistribution or modified/partial distribution. The [earlier pack page](https://gamebanana.com/apiv11/Mod/302224/ProfilePage) says ayrtonSilna reuploaded material by an unidentified original creator before continuing it. Neither page establishes that creator's grant or generic custom-pack sharing permission. See the D7 register. |
| [Square Series](https://gamebanana.com/mods/435309), submitted by ghytd | The pinned `squarever051.zip` supplies exact author-file VPKs for the saved No Burning Overlay and No Sentry Shield Overlay Casual choices. The app verifies the complete archive, each VPK and its game tree before local packing. Profile ZIPs carry selection metadata without the author archive or generated preload pack. | The [current checklist](https://gamebanana.com/apiv11/Mod/435309/LicensePage) allows direct download/install and asks before redistribution or modified/partial distribution. The [credits](https://gamebanana.com/apiv11/Mod/435309/ProfilePage) and archive do not separately identify overlay creators or grant profile-sharing rights. See the D7 register. |
| [Venom Crosshairs](https://github.com/hbivnm/Venom-Crosshairs) and the [community list](https://github.com/hbivnm/Venom-Crosshairs-List) by HbiVnm and contributors | New catalog downloads are retired. Existing profile packs retain previously installed VTFs, including through switch and profile export/import; execs rebuilds them from saved local bytes. | Tool GPL-3.0; list unlicensed, crosshairs belong to their authors. Users should review sharing rights before exporting a pack containing these textures. |
| [TF2Hitsounds](https://github.com/WishingStardust/TF2Hitsounds) by WishingStardust | New catalog downloads are retired. Previously installed WAVs remain in profile packs and can still play and be auditioned; execs no longer re-fetches originals to change their baked boost. | No reuse license was found for the pinned sounds; they belong to their authors. Users should review sharing rights before exporting a profile containing them. |
| [mastercomfig cvar reference](https://github.com/mastercomfig/mastercomfig/tree/release/docs/tf2) | `packages/cfglint/src/cvars.gen.ts` contains pinned Windows/hidden command dumps and alias metadata from comfig configuration. Source revisions and applicability accompany the offline catalog. | MIT |
| [Valve Source SDK](https://github.com/ValveSoftware/source-sdk-2013) | Independently described command argument and bound facts with source provenance supplement the offline catalog; no SDK implementation is copied or vendored. | Source SDK license (upstream); metadata only. See `packages/cfglint/CATALOG.md`. |
| ICE cipher by Matthew Kwan | `core/src/ice.rs` is a port of the reference implementation, used to read weapon scripts from the user's own game files. | Public domain |

The [D7 asset-rights register](docs/audits/2026-09-23-program-audit/d7-asset-rights.md) records the pinned files, local installation uses and unresolved permission evidence for CompVMInstaller, Venom Crosshairs, TF2Hitsounds, comfig.app hosted sounds and cueki's default mod library. It does not treat repository visibility or attribution as a grant.

The Mods pane browses and downloads from [GameBanana](https://gamebanana.com) through its public API; each mod
belongs to its author. The app also talks to GameBanana, teamfortress.tv and Dropbox to resolve HUD
downloads linked from hud-db, links out to authors' imgur albums, and reads download and view
counts from [tf2huds.dev](https://tf2huds.dev). The app package does not
redistribute downloaded HUD or mod files. A user-initiated profile export can
contain an installed HUD or mod; its sharing rights remain the user's to check.

## Design inspiration

The inventory organizer under development is inspired by
[Jengerer's Item Manager (JIM)](https://www.jengerer.com/item_manager/), by
Jengerer and its contributors. No JIM code or assets are copied or distributed.
No reuse license was identified in its public repository. The standalone
development probe and its protocol references are documented in
[`tools/inventory-probe/README.md`](tools/inventory-probe/README.md).

## Fonts and icons

- [Inter](https://rsms.me/inter/) by Rasmus Andersson, via `@fontsource/inter`. SIL Open Font License 1.1.
- [Phosphor Icons](https://phosphoricons.com/). MIT.

## Libraries

- [CodeMirror 6](https://codemirror.net/) and [Lezer](https://lezer.codemirror.net/)
  power the local Files editor, search, history and completion. MIT licenses;
  package versions and full notices are included in the dependency inventory.
- [libcurl](https://curl.se/libcurl/) through the [curl Rust binding](https://github.com/alexcrichton/curl-rust)
  handles HTTPS downloads with destination-bound connections. Windows uses
  Schannel; Linux uses OpenSSL. Their licenses and exact locked versions are
  included in the packaged dependency inventory.

Runtime dependencies are listed in `apps/desktop/package.json` and
`apps/desktop/src-tauri/Cargo.toml`. The Rust and JavaScript dependency inventory records permissive licenses
(MIT, Apache-2.0, BSD, ISC, Zlib, Unicode, MPL-2.0 for a few unmodified
crates). Linux builds use GTK and WebKitGTK under their upstream terms; AppImage system libraries and their notices are bundled separately.

## Valve

Team Fortress 2, Steam and their file formats belong to Valve Corporation.
The repository and installers do not package Valve's game archive files.
execs reads sprites, sounds and weapon scripts from the player's own install to
build profile content. A user-initiated profile ZIP export copies the profile's
packs, which may contain game-derived bytes or third-party content. The player
controls whether to share that ZIP. The [D7 register](docs/audits/2026-09-23-program-audit/d7-asset-rights.md)
tracks unresolved rights questions, including the proposed use of stock models
in a replacement Viewmodels builder. execs is a fan project and is not
affiliated with Valve.

## Packaged notices

The installed `notices/` directory includes full Inter, Phosphor, JavaScript and
Rust dependency licenses, and the comfig screenshot/cvar-reference notices.
Linux packages also carry system-library notices. This inventory records licenses;
it does not imply that unanswered community permission requests were granted.
See `docs/release-0.1.1.md` for the owner's continuation decision and validation.
