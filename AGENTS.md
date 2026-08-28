# execs — agent notes

Working agreement: durable product/design decisions get recorded here as they are made.

## Product identity
- Name "execs" is a working name — renameable before launch.
- The product is a **Windows + Linux desktop companion** (Tauri 2 + existing React/TS UI, `cfglint` as a library). Not a website.
- The Cloudflare community hub (Steam login, browse, upload, R2, D1) is **parked**. Do not build hub features in parallel.
- V1 audience: TF2 players setting up a fresh install or switching named setups. No Steam login required.
- Everything we ship is **first-party** except mastercomfig (integrated, not rebuilt). Do not embed other community apps.

## Integrity line
- File-safe only. Write `tf/custom/`, `tf/cfg/overrides/` (or vanilla `tf/cfg` user files if comfig is absent), and TF2's Steam Cloud `config.cfg` copy.
- Never patch official `tf/tf2_*.vpk`, never edit `gameinfo.txt`, never ship a casual-pre-loader / `sv_pure` bypass.
- Skins/models/particles in `tf/custom/` may be stored and switched. Valve Casual will still strip most of them. Community/listen servers will not. Do not claim otherwise.
- Never write `tf/cfg/user/` (removed in mastercomfig 9.9.3). Never write `tf/steam.inf`.

## Profiles
- A profile is the **entire file-safe customization surface**: user cfg layer, `tf/cfg/config.cfg`, **all of `tf/custom/`**, and a launch-options string.
- Switching is **exact replace**, not merge. Inactive profiles live in app data, never under `tf/custom/` (TF2 would mount them).
- Library: Windows `%AppData%\execs\profiles`, Linux `~/.local/share/execs/profiles`. Live game folder holds only the **active** set.
- Export/import is a zip. `mastercomfig-base.vpk` may be shared **by hash** across profiles; everything else is exclusive.
- App can stay open while TF2 runs. **No writes** while `tf_win64.exe` / `tf_linux64` is running.
- After TF2 quits: owned-file / `config.cfg` drift **absorbs automatically** into the active profile. New or deleted packs in `tf/custom/` **prompt, default Update**. Never silently roll back to an old snapshot.
- Steam Cloud stays on. On absorb and on switch, write the same `config.cfg` bytes to `tf/cfg/config.cfg` and `userdata/<id>/440/remote/cfg/config.cfg`. Do not delete Cloud files (Steam redownloads them).
- Progress UI shows real steps (game closed → pack current → remove live packs → write files → Cloud → done), not a fake spinner.

## First run and new profiles
- Find TF2 by scanning Steam libraries (registry, `libraryfolders.vdf`, `~/.local/share/Steam`, `~/.steam/steam`, Flatpak data dir). Confirm `tf/steam.inf` app `440`. Always offer Browse. Multiple installs → picker. Remember one root; profiles are tied to it. No silent write until the path is confirmed.
- **Existing customization:** first launch only **Save current as…**. Do not install comfig on top until they ask.
- **Unused install:** first launch is the setup wizard.
- **Create new profile** (after they already have one) is when the wizard runs for existing users.
- A new profile is a **fresh TF2**: stock binds from Valve `config_default.cfg`, wizard comfig layer, empty `tf/custom/` except official VPKs they picked. Different profile = different binds.
- Inherit-binds is a **settings checkbox**, off by default, not a dialog on create.
- Do not run the nuclear clean-up (`delete tf/cfg` + `-autoconfig -default +quit`) as a normal switch or create.

## mastercomfig
- Do not rebuild the VPK core, interp research, class-cfg takeover, or comfig.app's bind/weapon-VTF customizer.
- V1 in-app: **our UI** for preset, modules, addons. Fetch **official GitHub Release** VPKs at install/update time. Write `tf/cfg/overrides/` (`modules.cfg`, `setup_hook.cfg`, etc.).
- Credit + link to https://comfig.app and their support/donate. Do not brand as official mastercomfig. Do not bundle a stale VPK in our repo as "ours."
- Button to open https://comfig.app/app for extras; import `comfig-custom/` if they used it.

## V1 settings UI
- **Comfig** — preset, modules, addons.
- **Binds** — click-to-record for usual actions (movement, jump/duck, medic, use, voice, loadout). No alias/script studio.
- **Gameplay** — FOV, viewmodels, stock crosshair, obvious toggles. First-party; writes overrides.
- **Files** — raw cfg + `cfglint`.
- **Launch options** — copy-to-clipboard. Auto-write `localconfig.vdf` only if Steam is already closed. Never force-quit Steam to finish setup. Never store `-autoconfig`, `-default`, `-dxlevel`, or `+quit` on a profile.

## Not V1 (profiles still carry these files if already present)
- Schema HUD customizer, per-weapon VTF crosshair builder, Horsie/Yttrium animation compiler, HUD catalog beyond detecting a HUD folder.
- Sharing site / Steam auth. Later: export zip is enough to start.

## Updates
- The app has an **in-app updater**: GitHub Releases + Tauri updater. Show “update available,” they click to install. No silent force-replace, no analytics/telemetry.
- mastercomfig VPK updates are a **separate** control on the Comfig pane (their GitHub releases, not ours).

## Implementation status
- Product grill is **done**. This file is the V1 spec.
- Linear: [execs](https://linear.app/rndaom/project/execs-a89f9a30e95c) (team Rndaom). Next issue: [RND-144](https://linear.app/rndaom/issue/RND-144) scaffold `apps/desktop`.
- Do not start HUD/crosshair/viewmodel studios (Later studios backlog).

## Design decisions
- posts.tf dark minimalism × TF2 identity: bg `#121212`, ink = TF2 tan `#EBE2CA`, accent = item orange `#CF6A32`, pill buttons, item-quality colors for badges only.
- Display font: Big Shoulders Display (free, OFL) behind the `--font-display` token — a TF2-Build lookalike. Swap only if TF2 Build web licensing is ever verified.
- Not affiliated with Valve / Steam. Credit mastercomfig where we use it. "Powered by Steam" footer is hub-era; desktop copy still needs a not-affiliated disclaimer.

## Deployment (legacy hub — parked)
- Old live URL: https://execs.anthonyrandomcarey.workers.dev (Cloudflare Worker "execs"). Do not treat as the product.
- Production D1 / R2 remain from the hub; no new hub migrations unless someone un-parks it.
- `.npmrc` `node-linker=hoisted` — still required on Windows for this monorepo. Don't remove it.

## Conventions
- Plain `package.json` scripts only (Windows dev machine) — no bash-isms.
- LF line endings enforced via .gitattributes; cfg fixtures must never be CRLF.
- `design-qa.md` is a dated QA log; add an entry per visual QA pass.
