# Where execs is — 0.2.0 status

The single handoff page. Read this first in a new session, and update it at the end of each session. AGENTS.md holds the durable rules; Linear holds each issue's acceptance criteria; this page says where things stand and what comes next.

Last updated: **September 25, 2026**.

## At a glance

- **Public release:** v0.1.8. Nothing newer is published.
- **0.2.0 work lives on** `rndaom/foundry-overhaul`, integrated into `main` through draft PR #60. Every change goes on its own `rndaom/<topic>` branch, becomes a PR into `rndaom/foundry-overhaul`, and is squash-merged once CI is green.
- **0.2.0 scope** (owner decision, September 25, 2026): everything in the Linear **0.2.0** milestone, including all `execs-candidate` issues. Inventory stays development-only and is not part of the release.
- **No release date.** Publishing needs the owner's explicit go-ahead after RND-251 passes.

## Done and merged (September 24–25)

| Work | PRs | Verified |
|---|---|---|
| Viewmodels builder from the player's installed TF2 files: per-weapon Shown / Hidden / Hands only, recipe-only export, available in release builds | #90–#104, #106, #108 | Retail TF2 on Windows (Scout). Owner signed off without rendered previews. |
| Faster profile switching: Casual preloader plan built once per switch (release 10.6 s → 4.7 s; dev about 50 s → 8 s) | #105 | Owner, in the dev app |
| Launch TF2 flags and writes missing Steam launch options, restarting Steam with consent | #107 | Owner, native Windows |
| Loading cog across the app; full-window shell before a profile is active | #106 | CI and browser preview |
| Audit finding D7 closed by the owner's containment decision; audit at 35/35 | #109 | Docs only |

Linear's free plan is at its issue limit, so this work is recorded as comments on RND-208, RND-202, RND-231, RND-324, RND-267 and RND-206 instead of new issues.

## Code-complete, waiting for the final test pass (RND-251)

RND-202, RND-213, RND-214, RND-215, RND-246, RND-274, RND-290, RND-291, RND-292, RND-294, RND-324, RND-325. These are In Progress in Linear only because native qualification is outstanding. Close them as RND-251 confirms each one.

## Still to build — the order to work in

Work top to bottom, one issue per branch and PR. Before starting an issue, read its Linear acceptance criteria and check what already exists: several were written before later work landed.

**1. Finish what is partly done**
- **RND-231** Launch pane feedback. #107 covers the header flag and the write on launch. Still needed: distinct Saved to profile / Copy into Steam / Written to Steam states, and retry inside the Launch pane.
- **RND-298** GameBanana file variants. Author-file choice with name, description and size already exists. Check the remaining acceptance: dates, multipart instructions, dead links.
- **RND-217** Binds actions. The description is stale: attack, reload, slots, chat and voice menus already exist. Add what's missing, such as scoreboard and class/team menus, plus grouping and search.

**2. Small profile features**
- **RND-222** Rename profiles
- **RND-223** Duplicate a saved profile without switching
- **RND-230** Return to stock HUD

**3. Settings panes**
- **RND-219** Mouse and zoom sensitivity
- **RND-220** Gameplay comfort section (auto-reload, fast switch, damage numbers…)
- **RND-218** Bind conflicts, secondary keys and clear
- **RND-225** Bring viewmodel FOV, draw and transparency into Viewmodels. The description still assumes the old Windows-only builder; revise it against the new one.
- **RND-226** Whole-profile viewmodel presets. The description still assumes 64 groups; revise it for per-weapon choices.
- **RND-227** Simplify Sounds browsing
- **RND-229** Show which particle mod wins each conflicting file
- **RND-299** Explain a setting's cfg source and class context

**4. Larger features**
- **RND-232** Storage usage and safe cache clearing
- **RND-296** Installation health and offline readiness
- **RND-295** Preview profile differences before switching
- **RND-297** Local profile restore points
- **RND-221** Safe uninstall flow in App settings

**5. Internal and external**
- **RND-301** Keep Rust and TypeScript bridge types in sync
- **RND-204** Trim redundant comments. The earlier uncommitted patch was lost, so start over.
- **RND-191** Windows Authenticode signing. Needs the owner to set up SignPath (or another signer) first; the code side follows.

**6. Release**
- **RND-267** Linux Viewmodels build. The new builder has no Windows-only code; confirm it in a native Linux build and in TF2 during RND-251.
- **RND-251** Cumulative Windows and Linux release test pass on the final candidate.
- **RND-208** Validate and publish 0.2.0, only with the owner's go-ahead.

## Working notes for the next session

- **Worktrees:** use short paths like `G:\wt\<name>` with `git config core.longpaths true`. Evidence folders under `docs/` exceed Windows' default path limit.
- **Your terminal is Windows PowerShell 5.1:** run commands one per line; `&&` isn't supported.
- **Rust tests and TF2:** tests that touch profiles fail with `GameRunning` while TF2 is open. Close TF2 or rely on CI.
- **Dev app:** don't edit Rust while `pnpm desktop:dev` is running; a rebuild restart can interrupt a profile switch. If a switch is interrupted, the app offers recovery: switch to the named profile.
- **Casual content** (custom viewmodels, particles) needs the profile's `+exec` preload launch option in Steam. Launch TF2 now writes it; if content doesn't load, check Steam's launch options first.
- **Linear:** the workspace is at the free-plan issue limit. Record new work as comments on the closest issue until issues are archived or the plan changes.
- **Backups:** deleted branches from the September 25 cleanup are bundled in `G:\Projects\execs-archive-2026-09-25\` (`git fetch <bundle> <ref>:<branch>` restores one). Its `local-only` folder holds the untracked `.artifacts` scratch and four never-pushed September 13–20 audit folders moved out of `docs/audits`.
- **History versus current:** everything under `docs/design/` and `docs/audits/`, and the `docs/release-*.md` files, are dated records. Where they conflict with this page or AGENTS.md, this page and AGENTS.md win.
