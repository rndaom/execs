# execs — project guide for agents and contributors

execs is a Windows + Linux desktop companion for Team Fortress 2 (Tauri 2, Rust core, React/TypeScript UI). It keeps a player's whole customization surface as named **profiles** and switches between them while the game is closed. This file is the working spec: durable decisions live here, in present tense. Add a line when a decision is made; delete lines that stop being true.

## Repo

```
apps/desktop/            Tauri app (the product)
  src/                   React UI: one file per pane, lib/ (pure logic + tests), hooks/, components/ui/
  src-tauri/src/         Tauri crate `execs`: commands/ (IPC), net.rs, *_fetch.rs, gamebanana.rs, hud_stats.rs
  src-tauri/core/        `execs-core`: everything that touches disk, no Tauri/WebKit
packages/cfglint/        Source cfg parser/linter (TS), used by the Files pane
tools/promo/             Remotion promo video; outside the pnpm workspace (`pnpm install --ignore-workspace`)
docs/media/              README screenshots and the promo GIF
.github/workflows/       ci.yml (frontend, rust-linux, rust-windows), release.yml (tag → draft → verify → publish)
```

Commands: `pnpm install`, `pnpm desktop:dev` (Tauri), `pnpm dev` (browser only, fixture data via `?preview=<state>`; states in `src/lib/preview.ts`), `pnpm test`, `pnpm check` (biome), and for Rust `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace --locked` with `--manifest-path apps/desktop/src-tauri/Cargo.toml`. CI runs all of these; keep them green. `.npmrc` `node-linker=hoisted` is required on Windows. Vite defaults to port 1420 (`EXECS_DEV_PORT` moves it; `tauri.conf.json` `devUrl` must match). Plain `package.json` scripts only, LF everywhere (`.gitattributes`), cfg fixtures never CRLF.

## Architecture

- **Core owns disk, the crate owns network, the UI owns drafts.** `execs-core` has no networking; `*_fetch.rs` / `gamebanana.rs` download through `net.rs` (one client, `execs/<version> (+https://github.com/rndaom/execs)` user agent, size caps, pinned URLs, sha256 where the source publishes one). Commands in `src-tauri/src/commands/*` are thin: `blocking` / `with_root` / `with_profile` run work off the main thread; writes take the `WriteGate` mutex.
- **Errors** are `{ code, message }` (`error.rs`); the frontend's single `call<T>()` in `lib/bridge.ts` turns them into `BridgeError`. Every command has a preview twin in `lib/preview-bridge.ts` (the `Api` type is derived from `bridge.ts`, so a new command cannot be forgotten there).
- **Pane logic lives in `lib/*-ui.ts` with unit tests**; components stay thin. Drafts use `useSeededDraft` keyed by profile id so a switch never leaks a draft into another profile.
- **Crash hardening:** no `panic = "abort"`; panics log to `<data dir>/logs/panic.log`; the lock poller wraps each tick in `catch_unwind`; heavy work never runs on the main thread.
- **Data dir:** Windows `%AppData%\execs`, Linux `$XDG_DATA_HOME/execs` or `~/.local/share/execs` (`settings.json`, `profiles/`, caches per feature, `preloader/originals` snapshots, `logs/`). Not Tauri's app-data dir.

## Integrity rules

- The file-safe surface is `tf/custom/`, `tf/cfg/overrides/` (or the vanilla `tf/cfg` user files when mastercomfig is absent), and TF2's Steam Cloud `config.cfg` copy. Nothing else is written, with one exception below.
- **Never** write `tf/cfg/user/`, `tf/steam.inf`, or anything while the game runs. Never store `-autoconfig`, `-default`, `-dxlevel`, `+quit`, or `gamemoderun %command%` on a profile. Never write `localconfig.vdf` while Steam runs.
- **Write lock:** process name `tf_win64.exe` (Windows), `tf_linux64` or `tf_win64.exe` under Proton (Linux). `refuse_if_running()` guards every live-surface and library write; app-data settings writes stay allowed.
- **Preloader exception (Mods pane):** `gameinfo.txt` gets only the reversible `type multiplayer_only` ↔ `//type` toggle, pristine copy backed up first; `particles/*.pcf` DATA is patched in place, size-preserving, inside the sibling `tf2_misc_*.vpk` archives. **The `_dir.vpk` is never written, not even a CRC**: the directory carries Valve's tree checksum and sv_pure validates against its stock CRCs, so a rewritten CRC makes pure servers reject the whole archive (magenta everything). Every patched entry is snapshotted first; Restore stock files puts every byte back.
- Every write to a file that matters goes through `hash::write_atomic` (`<file>.execs-part` then rename). Absorb repairs a write that was cut off mid-copy (see Profiles).

## Profiles

- A profile = user cfg layer + `tf/cfg/config.cfg` + all of `tf/custom/` + launch options + records for HUD, crosshair, viewmodel, hitsounds and mods. Library at `profiles/<uuid>/` with `manifest.json` (per-file sha256), exclusive trees, `mastercomfig-base.vpk` shared by hash. Export/import is a zip.
- **Switch is exact replace, not merge.** Sources are validated before the Remove step, files are written atomically, the active id flips last; a failure after Remove clears the active id and the UI says re-apply. Previous exclusive files are removed only when the live hash still matches.
- **Absorb** runs on boot and after TF2 quits: owned-file and `config.cfg` drift goes into the active profile automatically (Cloud copy dual-written); new or deleted packs prompt with Update (default), Restore removed, Keep. Keep is remembered in `ignored_packs`; Update clears it. Never silently roll the live folder back.
- **Junk is never a pack:** `*.execs-part`, and Steam's own `tf/custom/readme.txt` and `workshop/`, are ignored everywhere. **Self-heal:** before classifying, absorb rewrites any manifest file missing from the live tree when its `.execs-part` sibling exists or the pack is app-owned (`execs-*`), deletes stray part files, and drops those keys from the ignore list (field incident: the dev app restarted mid-switch and left a half-written viewmodel pack).
- Global, not profile-owned: `tf/custom/execs-preloader.vpk` (`GLOBAL_CUSTOM_FILES` in `surface.rs`).
- The switch progress panel shows only real steps (game closed → pack current → remove → write → Cloud → done), paced to a minimum display time; never invented steps or percentages.

## First run

Find TF2 through Steam library folders (registry, `libraryfolders.vdf`, `~/.steam`, Flatpak, Snap), accept only a root whose `tf/steam.inf` says app 440, always offer Browse, remember the root only after Confirm. Existing customization → **Save current as…** only. Unused install → the setup wizard (name, preset, official addons). Create new profile reuses the wizard with **Start from: Current setup** (copies the active `config.cfg` verbatim, so no tutorial pop-ups) or **Fresh TF2** (Valve's `config_default.cfg`). No silent write before the path is confirmed.

## Panes

- **Comfig** — preset, modules, official addons through our UI; VPKs come from mastercomfig's GitHub releases; writes `tf/cfg/overrides/{setup_hook,modules}.cfg`. Extras and the preset guide open in an in-app `WebviewWindow` with no IPC. Credit comfig.app; never brand as official.
- **Binds** — click-to-record for the usual actions; writes `execs_binds.cfg`. Autoexec exec lines are addressed from `tf/cfg` (`exec overrides/execs_binds`): the engine resolves `exec` per search path, so a bare stem inside `overrides/` silently fails (field bug). No alias studio, no `unbindall`.
- **Gameplay** — FOV, viewmodels, tracers, flip; writes `execs_gameplay.cfg`. Transparent viewmodels is an addon VPK toggle, never a cvar.
- **HUD** — hud-db catalog (paginated, sorted by name / last updated / downloads / views via comfig.app and tf2huds.dev stats, cached a day), one HUD per profile, install kinds by host (GitHub codeload zip, Dropbox `dl=1`, GameBanana download page, teamfortress.tv thread scrape, or link out), import from zip/7z/folder (RAR refused), TF2HUD.Editor schemas consumed as data (parser strips `//` comments, options may lack `Name`). Imgur albums open in the browser; GitHub `showcase.md` albums load in-app.
- **Crosshair** — stock crosshair controls with live previews decoded from the user's own `tf2_textures_dir.vpk`; the custom builder writes `tf/custom/execs-crosshairs/` (VTFs + patched weapon scripts read from the user's `tf2_misc_dir.vpk`, ICE-decrypted in process). Sources: first-party shapes, the parametric designer, imported PNG, Venom Crosshairs (173 entries, pinned). Tint is cvar-based (`cl_crosshair_red/green/blue`), textures stay white; apply forces `cl_crosshair_file ""`. VTF header: bumpScale@48, format@52, mips@56.
- **Viewmodels** — Yttrium-style per-class groups only (64, table in `viewmodel_groups.rs`): fetch pinned `animations.zip`, rewrite chosen SMDs off-screen (`full` hides arms too, `weapon` keeps the hands), compile with the install's own `studiomdl.exe` in an isolated staging root (Windows only today), pack with our VPK writer. Hidden in third person too (one c_ model). Previews are CompVMInstaller's screenshots, fetched pinned. Prebuilt VPK import remains.
- **Sounds** — hit and kill sounds are exactly `tf/custom/execs-hitsounds/sound/ui/{hitsound,killsound}.wav` (the two names sv_pure exempts). Engine formats: 8/16-bit PCM or 4-bit MS-ADPCM at 11025/22050/44100 Hz; other WAVs are re-encoded, MP3-as-WAV refused. Sources: stock effects from the user's `tf2_sound_misc_dir.vpk`, TF2Hitsounds (pinned), comfig.app hits (pinned index, streamed by hash, ADPCM decoded for audition only), the user's own WAV. **Boost** (0/6/12 dB, tanh soft clip) re-encodes the file louder because the engine caps `tf_dingaling_volume` at 1; entries keep their source token/hash so a later boost re-encodes from the source. `sound.cache` is deleted on apply.
- **Mods** — Casual preload switches (itemtest preload cfg + the gameinfo bypass; one home, this pane), **Your mods** (`ModRecord`s over ordinary `tf/custom` packs: multi-select .vpk/.zip/.7z with content-root detection, or a folder; RAR and multi-part VPKs refused with a message), **Browse GameBanana** (`gamebanana.rs`, game id **297**: `Mod/Index` with `_sSort`, search filtered to `_sModelName=Mod`, installable categories only, thumbnails from `images.gamebanana.com`, page-at-a-time; mature-rated records hidden unless the user flips the switch, since the API has no filter), and cueki's default library (`mods.zip` pinned + sha256) plus profile mods that carry `particles/*.pcf` as particle sources. Duplicate-carrier PCFs are rebuilt from the user's own vanilla files; `blood_trail` maps to `npc_fx`. A resized `tf2_misc` (TF2 update) judges every entry by its stock CRC; untracked modified entries are repaired through `steam://validate/440`.
- **Files** — raw cfg editor with cfglint (`trust: "self"`); provided files (engine, HUD, packs) are read-only and their findings advisory; only `tf/cfg/config.cfg` is engine-managed (archived `password "0"`, `unbindall`, `con_enable` accepted). Block findings refuse Save; nothing is stripped silently.
- **Launch** — launch options on the profile; `localconfig.vdf` written only when Steam is closed, otherwise copy to clipboard.
- **Header** — Launch TF2 (`steam://rungameid/440`) while the game is closed; the running dot while it runs. The top banner is the only lock indicator.

## Saving

Cvar and small-file panes autosave (`useAutosave`: 700 ms debounce, coalesced, deferred while TF2 runs, flushed when the lock lifts or the pane changes). One toast reports every write: "Saving…" only past 400 ms, "Saved" briefly, a failure that stays until the next success or Escape, "Draft kept until TF2 closes" once. Controls stay live while TF2 runs. Heavy or destructive actions keep a button that says what happens: Build pack, Apply mods, HUD install/update/import, Files Save/Discard, Remove pack, Remove sound files. No "packages installed" style status text when everything is fine.

## Third-party sources

All fetched at runtime, pinned, credited in the UI, the README and `THIRD_PARTY.md`: mastercomfig (releases, cvar dumps for cfglint, preset screenshots vendored, hits index), hud-db, TF2HUD.Editor schemas, CompVMInstaller (no upstream license; permission requested), casual-pre-loader (GPL, behaviour re-implemented clean-room, mods.zip downloaded), Venom Crosshairs, TF2Hitsounds, GameBanana. Do not vendor GPL code, Valve sprites or sounds, `vtf2tga.exe`, or AI-generated preview art. Imgur's API is not used.

## Updates and release

In-app updater (Tauri updater plugin) against `https://github.com/rndaom/execs/releases/latest/download/latest.json`; check on launch and via the footer, install only on click, no telemetry. Windows NSIS per-user with `installMode: passive`, static MSVC CRT, `longPathAware` manifest; Linux AppImage (GStreamer bundled, self-updates) and `.deb` (first install only; the publish job strips it from `latest.json`). Release = bump `version` in `tauri.conf.json`, `Cargo.toml`, `package.json`, push `vX.Y.Z`; the workflow guards the version, builds both platforms into a draft, verifies both `latest.json` entries, then publishes. Signing: updater minisign key in CI secrets; installers are not Authenticode-signed yet (SignPath planned). Footer has Report a bug (issue forms) and Copy diagnostics (`get_diagnostics`).

## Design system

Tokens only in `apps/desktop/src/index.css` `@theme`: bg `#121212` → panel `#181818` → panel-raised `#1F1F1F`, hairlines as ink alpha (8% / 14%), warm ink `#ECE7DA`, accent `#CF6A32` spent on exactly four things (primary button, selected ring, active nav marker, wordmark dot). Inter only; six type steps (`.t-pane`, `.t-section`, `.t-row`, body, `.t-meta`, `.eyebrow`). Flat sections with hairlines, boxes only for real surfaces, overlays and option tiles (selected = ring + 6% wash + dot, never a check mark). No `<select>` where a `Segmented` pill or a picture grid will do, no native checkboxes (switch rows), no inner scroll boxes, disclosures for depth. Hero-row rule per pane (`PaneHeader` + the one decision + a 360 px preview). Motion: 150 ms colour/opacity, 220 ms movement, nothing under `prefers-reduced-motion`. Copy: sentence case, ledes ≤ 9 words or none, descriptions only when they carry a rule, buttons say what happens.

## Gotchas worth remembering

- Launching the real game for a test must not pass video flags (`-w`, `-h`, `-windowed`, `-noborder`, `-fullscreen`, `-dxlevel`): Source persists them into `HKCU\Software\Valve\Source\tf\Settings`. `-condebug` is fine; `-console` persists `con_enable`.
- `C_OP_RenderSprites::RenderUnsorted … unimplemented sprite renderer` console floods mean a particle system whose material failed to load, not a PCF bug.
- comfig.app's CDN challenges empty or bare-library user agents; our UA string is enough.
- GameBanana's `Generic_LatestAdded` sort does not exist (`Generic_Newest` does); listings carry no download counts.
- Linux clippy flags imports used only by `#[cfg(windows)]` tests: import inside the test fn.
- Bash heredocs in the agent environment mangle backslashes; write patch scripts to a file first.
- Never add AI co-author trailers to commits.
