# Whole-program integration and UX audit — 2026-09-23

Implementation and verification progress is tracked in [remediation.md](remediation.md). A checked item there means the named fix has passed its listed checks; items still open remain findings of this audit.

This is a read-only audit of the current `execs` development tree, its browser fixtures, and the external systems it uses. The tree was already modified when the audit began; base commit was `91f7331`. The only files added for this audit are this report and its 26 browser screenshots. No release, product code, Steam installation, TF2 files, or user profile data was changed.

Seven independent reviews covered profile/core writes; crosshair sources; HUDs and Mods; network and upstream sources; TF2 and Source behavior; architecture/tests; and frontend journeys. We reconciled overlapping findings against the code. **A code path or upstream document is evidence of a risk, not a claim that a particular retail TF2 installation has exhibited it.** The scenarios below need the named fixture or retail test before a fix is called verified.

## Executive readout

The most serious gap is that **profile ownership, installed files, and the content TF2 actually loads are three different things**. The app tracks files by profile and pack path, while TF2 mounts loose folders and VPKs into a shared virtual namespace. A pane may truthfully report what execs saved and still misstate the effective crosshair, HUD, viewmodel, sound, weapon script, or CFG after another pack, launch command, class CFG, or server rule wins. TF2's tracked [`gameinfo.txt`](https://github.com/SteamTracking/GameTracking-TF2/blob/master/tf/gameinfo.txt) and [Valve's Source filesystem implementation](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/public/filesystem_init.cpp) support the mount-order concern; exact server/map behavior remains conditional.

The highest-priority code findings are:

1. **Profile switches can retain or overwrite untracked live packs.** A pack excluded with **Keep profile** stays mounted during a later switch; a target pack at the same path can replace its bytes. Deleting an active profile while keeping its installed setup creates a similar untracked handoff to the next profile. See [A1](#a1-kept-external-packs-can-leak-across-profiles-or-be-overwritten) and [A2](#a2-deleting-an-active-profile-can-leave-its-mods-in-the-next-profile).
2. **Viewmodel VPK import accepts unrelated mounted content.** A structurally valid, user-selected VPK can contain `cfg/autoexec.cfg` or other content and bypass the CFG validation used by Mods. See [A3](#a3-viewmodel-import-crosses-the-mod-cfg-trust-boundary).
3. **Crosshair controls can replace an external selection, and a custom build can collide with mod weapon scripts.** The pane does not resolve HUD overlays, modded stock assets, class CFGs, or competing VPK members. See [B1](#b1-an-unrecognized-crosshair-selection-is-lost-on-unrelated-edits), [B2](#b2-custom-crosshair-scripts-compete-with-mod-scripts), and [the source map](#effective-source-map).
4. **Binds has both an effective-state gap and a byte-loss path.** Rebinding can leave the previous key active; later managed-file regeneration can remove unrelated valid lines entered through Files. See [B5](#b5-binds-can-display-one-key-while-two-still-work) and [A4](#a4-binds-can-discard-user-edits-in-an-editable-managed-file).
5. **HUD Editor controls appear supported beyond their actual implementation.** All five effectively supported HUD schemas include a crosshair control that execs filters out; a rayshud background option appears editable but its `Special` operation is ignored. See [C1](#c1-hud-editor-crosshair-controls-are-hidden) and [C2](#c2-a-hud-background-choice-can-be-a-silent-no-op).

The current architecture has material strengths: disk writes are centralized in core, the write lock protects live surfaces, import/parser and download paths have bounds, command parity was checked for all 88 native `call(...)` names, and the preview API is structurally tied to the native bridge. The audit found integration gaps between these individually strong parts, not a general absence of protection.

## Method, coverage, and evidence limits

| Area | Inspected | Main evidence |
| --- | --- | --- |
| Profiles and lifecycle | First run, create/import/export, exact switch, absorb, delete, settings drafts, write gate | Core call chains, manifests, frontend state, existing transaction tests |
| Editing panes | Comfig, Binds, Gameplay, Crosshair, HUD, Viewmodels, Sounds, Mods, Files, Launch, app settings, dev Inventory | React panes, `lib/*-ui.ts`, Tauri commands, browser previews |
| External integration | GitHub/mastercomfig, hud-db, TF2HUD.Editor, GameBanana, Dropbox, tf2huds.dev, Venom, TF2Hitsounds, CompVMInstaller, cueki, Steam GC, updater | Pinned source checks, current APIs/docs, host/redirect/size checks in code |
| Source and TF2 | `tf/custom` search paths, cfg startup/class execution, HUD overlays, weapon scripts, `sv_pure` limits | Valve Source SDK, tracked TF2 files, mastercomfig and author docs, relevant community reports |
| Visual journeys | Existing/fresh first run, main panes, Files draft guard | 26 accepted screenshots from browser fixture; see [visual evidence](#visual-evidence) |

`pnpm --filter @execs/desktop test` passed **923 tests in 104 files**; `pnpm --filter @execs/desktop exec tsc --noEmit` passed; `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --locked` passed, with its existing environment-dependent ignored cases. A focused 61-test frontend selection also passed. This is the current modified tree, not a packaged candidate. We did not run `pnpm check`, clippy, a signed updater, Steam Cloud, retail TF2, a native screen reader, or Windows/Linux installer journeys. The [existing 0.2.0 qualification record](../../design/2026-09-22-overhaul/design-qa.md) separately leaves RND-251 and RND-324 open; this audit does not close them.

Priorities below describe potential user impact and the strength of the code path. **P1** warrants a near-term fix or blocking preflight; **P2** should enter the integrated feature plan; **P3** is a smaller coherence or documentation repair. “Code-confirmed” means the relevant call path was traced; it does not mean a new retail reproduction ran.

## A. Integrity and trust boundaries

### A1. Kept external packs can leak across profiles or be overwritten

**P1 · Code-confirmed; fixture pending.** With active profile A, add `tf/custom/shared.vpk` outside execs and choose **Keep profile**. [Absorb records the pack only in `ignored_packs`](../../../apps/desktop/src-tauri/core/src/absorb.rs#L353); later classification excludes it from `packs_added`, so [switch absorb does not capture it](../../../apps/desktop/src-tauri/core/src/absorb.rs#L437). Switching to B leaves a uniquely named pack mounted. If B owns a different `shared.vpk`, [target publication](../../../apps/desktop/src-tauri/core/src/switch.rs#L542) atomically replaces the ignored live bytes without a saved copy. The current behavior breaks the documented exact-replace profile model.

**Action:** Include ignored live packs in switch preflight. Require an explicit handoff disposition for each unmatched pack, and refuse a conflicting replacement until its bytes are captured or the user explicitly discards them. Add two fixtures: unique-name leak and same-path replacement.

### A2. Deleting an active profile can leave its mods in the next profile

**P1 · Code-confirmed; fixture pending.** Deleting active A with **Keep installed** [clears its active ID](../../../apps/desktop/src-tauri/core/src/profile_delete.rs#L233) while retaining its TF2 files. A later switch to B has no previous active profile to absorb or remove; the [switch journal enumerates tracked source/target paths](../../../apps/desktop/src-tauri/core/src/profile.rs#L3307), so A's ordinary `old.vpk` can remain mounted beside B. HUD folders have a special path, but ordinary packs do not.

**Action:** Represent the retained live setup as a pending tracked handoff until the next switch, or review/removal must be resolved before switching. Test active deletion followed by a switch to a profile that omits the old pack.

### A3. Viewmodel import crosses the Mod CFG trust boundary

**P1 · Code-confirmed; crafted VPK test pending.** The [Viewmodels command](../../../apps/desktop/src-tauri/src/commands/viewmodel.rs#L101) accepts a `.vpk`; [core import](../../../apps/desktop/src-tauri/core/src/viewmodel.rs#L233) checks metadata and VPK structure, then mounts the entire file as `execs-viewmodels.vpk`. It does not enumerate member paths. A valid VPK may contain `cfg/autoexec.cfg` (the [VPK parser tests](../../../apps/desktop/src-tauri/core/src/vpk.rs#L1521) demonstrate CFG members). [Mods import](../../../apps/desktop/src-tauri/core/src/mods.rs#L668) instead extracts and validates CFG members. Since TF2 mounts custom VPKs as content paths ([tracked gameinfo](https://github.com/SteamTracking/GameTracking-TF2/blob/master/tf/gameinfo.txt)), the Viewmodels route can install unrelated CFG, HUD, sound, or script files without that review.

**Action:** Require a viewmodel-only member allowlist with bounded enumeration and reject unrelated roots. At minimum apply the same CFG inspection and explicit trust policy as Mods. Add a synthetic VPK with `models/...` plus `cfg/autoexec.cfg` and prove import refuses it without touching live files.

### A4. Binds can discard user edits in an editable managed file

**P1 · Code-confirmed; helper reproduced.** Files lets the user edit `execs_binds.cfg` ([Files trust rules](../../../packages/cfglint/src/lint-options.ts#L68)), even though the file itself says it is managed. On `config.cfg` drift, [SettingsHost calls `syncTrackedBindsFromConfig`](../../../apps/desktop/src/SettingsHost.tsx#L300). That helper [serializes recognized action binds only](../../../apps/desktop/src/lib/binds-ui.ts#L475) when any tracked binding changes. A pure-helper run with an unrelated `alias customjump` and comments preserved neither after changing `bind w` to a new command. The [browser screenshot](screenshots/11-managed-file.png) shows the contradictory affordance.

**Action:** Define explicit ownership for lines inside managed CFGs. Preserve unrelated lines byte-for-byte when changing known bindings, or make those specific files read-only in Files and provide an intentional user CFG extension route. Test a managed file with a changed bind, alias, comment, and custom command.

### A5. Feature records can drift from their actual bytes

**P2 · Code-confirmed.** Absorb accepts external changes to owned hitsound, crosshair, or viewmodel files, but its [record reconciliation](../../../apps/desktop/src-tauri/core/src/absorb.rs#L883) updates mod counts and HUD identity, not the crosshair/viewmodel/hitsound records. [Profile detail](../../../apps/desktop/src-tauri/core/src/apply.rs#L63) still returns the old records. Files can also edit `execs_gameplay.cfg` without the [scoped crosshair metadata update](../../../apps/desktop/src-tauri/core/src/apply.rs#L390). The UI can label a sound or design that differs from the saved/live bytes.

**Action:** Treat each feature record as verified against required paths and hashes. On external changes, mark its provenance as changed/unknown and offer reimport, rebuild, or remove; never label it as the original asset without verification.

### A6. Imported ZIP metadata can claim missing feature payloads

**P2 · Crafted ZIP test pending.** [Profile ZIP import](../../../apps/desktop/src-tauri/core/src/zip.rs#L986) validates HUD and mod ownership but does not bind crosshair, viewmodel, and hitsound records to required payloads before [accepting those records](../../../apps/desktop/src-tauri/core/src/zip.rs#L387). A structurally accepted third-party ZIP can therefore produce an “installed” record without the matching pack.

**Action:** Validate every feature record against its required file set and manifest hashes before publishing the imported profile. Add intentionally inconsistent ZIP fixtures.

### A7. Sound settings and sound files commit in separate commands

**P2 · Code-confirmed.** [SettingsHost](../../../apps/desktop/src/SettingsHost.tsx#L1001) writes sound CVars, then calls `applyHitsounds`. [Source resolution or WAV installation](../../../apps/desktop/src-tauri/src/commands/hitsound.rs#L197) can fail after the CVars are durable, leaving new sound settings with old sound files/record. The failure toast retains the draft but does not roll back the earlier write.

**Action:** Stage and commit these as one core transaction, or make the UI explicitly report which half applied and offer a repair/retry that cannot misrepresent state. Test a controlled second-step failure.

### A8. Creating from Current setup can miss a recent live edit

**P3 · Timing-dependent.** The [wizard copies the active profile's saved `config.cfg`](../../../apps/desktop/src-tauri/core/src/wizard.rs#L293), while [live drift is absorbed later on switch](../../../apps/desktop/src-tauri/core/src/switch.rs#L225). An external edit after the last absorb and before creation may be absent from the new profile. The choice says “Current setup,” which suggests the visible live bytes.

**Action:** Under the write gate, reconcile or compare current live config before cloning, with a conflict review if it differs.

## Effective-source map

The product needs a common answer to **“what is actually active, and why?”** Currently panes use different notions of active: saved record, inferred startup CVars, filesystem path, mounted pack, and in-game runtime. A read-only source map can tie these together without taking edit ownership away from feature panes.

| Surface | Competing sources today | What the UI can misstate | First repair |
| --- | --- | --- | --- |
| Crosshair | Stock `cl_crosshair_*`; execs custom materials and full weapon scripts; other mod VPKs/materials/scripts; HUD overlay; `crosshair 0`; class CFG; Launch `+` commands | One preview and active mode despite a different or double mark | Preserve unknown CVar; inventory installed virtual paths and HUD overlays; show source/limits |
| Viewmodels | Global `r_drawviewmodel`; per-class model replacements; transparent-viewmodels addon; Mods Casual preload; other mod models | “Show” per class while global draw is off, or preload claimed in two panes | Share effective global visibility and preload owner |
| Binds/gameplay/sounds | `config.cfg`, autoexec/hooks, Files edits, class CFG, Launch `+exec`/`+cvar`, later in-game commands | One saved control value does not prove effective in-game value | Distinguish startup inference from runtime/conditional overrides; link to source file |
| HUD | Selected HUD root; retained legacy roots; Mods-supplied HUD content; Editor options; VPK member collisions | Selected HUD or option may not be the mounted one or may make no file change | Expose projected root and validate actual schema operations |
| Hitsounds | Managed canonical WAVs, other packs at same virtual paths, sound CVars | Installed record or audition differs from game | Virtual-path conflict scan and verified file provenance |
| Particles/preloader | Selected particle source mod, shared VPK/patch, itemtest launch hook, other particle mods | Source/feature owner can be ambiguous across Mods and Viewmodels | One preload owner/status and installed-path collision report |

This map should label certainty. Installed pack collisions are deterministic enough to flag locally; the winner can depend on alphabetical search path order. Maps and server `sv_pure` rules can change runtime behavior, so those need “server-dependent” language ([tracked `gameinfo.txt`](https://github.com/SteamTracking/GameTracking-TF2/blob/master/tf/gameinfo.txt), [Valve pure whitelist example](https://github.com/SteamTracking/GameTracking-TF2/blob/master/tf/cfg/pure_server_whitelist_example.txt)).

## B. Cross-pane state and conflicting content

### B1. An unrecognized crosshair selection is lost on unrelated edits

**P1 · Code-confirmed.** TF2's [crosshair renderer](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/client/tf/tf_hud_crosshair.cpp) accepts material names beyond the seven stock names. [The frontend parser](../../../apps/desktop/src/lib/gameplay-ui.ts#L433) maps any other `cl_crosshair_file` to empty, and [crosshair serialization](../../../apps/desktop/src/lib/gameplay-ui.ts#L234) emits that empty value when the user only changes size or color. This can replace an external custom selection.

**Action:** Round-trip unknown values as an “External: `<name>`” choice. Change only the CVar the user edited, or require an explicit switch to an execs-controlled crosshair. Fixture: external `cl_crosshair_file myreticle`, then change color and inspect bytes.

### B2. Custom crosshair scripts compete with Mod scripts

**P1 · Code-confirmed overlap; retail outcome pending.** The builder [copies Valve's full `tf_weapon_*` scripts](../../../apps/desktop/src-tauri/core/src/crosshair.rs#L992) and [writes replacements](../../../apps/desktop/src-tauri/core/src/crosshair.rs#L515), while [Mod import](../../../apps/desktop/src-tauri/core/src/mods.rs#L648) checks physical pack identity rather than duplicate virtual member paths. An explosion or weapon mod with the same script can shadow the crosshair override, or the generated script can shadow unrelated mod changes. TF2's mount ordering is documented by [tracked `gameinfo.txt`](https://github.com/SteamTracking/GameTracking-TF2/blob/master/tf/gameinfo.txt); a [community report](https://www.teamfortress.tv/63467/explosion) describes this exact kind of crosshair/explosion collision.

**Action:** Index case-insensitive virtual member paths for loose packs and VPKs before Build/import/switch. Show the conflicting pack, file, and predicted local winner; offer a reviewed composition only where parsing is safe. A future TF2 update also needs a source-hash/rebuild warning because [CrosshairRecord](../../../apps/desktop/src-tauri/core/src/profile.rs#L283) lacks upstream script identity. The [Valve weapon parser](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/game/shared/tf/tf_weapon_parse.cpp) reads fields beyond the crosshair; gameplay impact of stale client scripts still needs retail verification.

### B3. HUD overlays and modded stock art are absent from Crosshair preview

**P2 · Documented alternate render paths.** HUD authors can draw a font/layout crosshair independently of the engine one ([Hypnootize's HUD crosshair project](https://github.com/Hypnootize/TF2-HUD-Crosshairs), [Easy TF2 Crosshairs](https://github.com/omnibombulator/Easy-TF2-Crosshairs)). [Crosshair active mode](../../../apps/desktop/src/CrosshairPane.tsx#L131) comes from its own record, and [preview drawing](../../../apps/desktop/src/crosshair/CrosshairPreview.tsx#L34) does not inspect the selected HUD. The stock preview reads Valve's original VPK, not a modded `crosshair3.vtf` ([native preview](../../../apps/desktop/src-tauri/core/src/crosshair.rs#L948)). A double crosshair is therefore plausible without any indication in the pane.

**Action:** Detect selected HUD overlay controls/resources and modded stock sprite paths. Show “TF2 may draw another crosshair from [HUD/mod]” with a route to that owner; do not promise an exact visual preview when a game/server path is unknown.

### B4. Startup inference omits later overrides

**P2 · Code-confirmed model limit.** [CFG inference](../../../apps/desktop/src/lib/cfg-state.ts#L5) models startup files. The [Launch option sanitizer](../../../apps/desktop/src-tauri/core/src/launch.rs#L599) intentionally retains user `+exec` and `+cvar` commands, which can override settings shown by Binds, Gameplay, Crosshair, or Sounds. [mastercomfig warns](https://docs.comfig.app/latest/tf2/misconceptions/) that `+exec autoexec/config` repeats commands, and [documents class CFGs](https://docs.comfig.app/latest/customization/custom_configs/) that run on class switches. Source's [`+` command-line behavior](https://developer.valvesoftware.com/wiki/Command_line_options) is general evidence; current TF2's packed `valve.rc` timing was not inspected. `crosshair 0` is also [not modeled](../../../apps/desktop/src/lib/gameplay-ui.ts#L112).

**Action:** Label startup-inferred values as such; index launch commands and class CFGs as conditional later sources. Surface the file/line or option responsible when known. Do not disable unrelated editing merely because a later command exists.

### B5. Binds can display one key while two still work

**P1 · Code-confirmed; retail binding test pending.** The pane shows one [“Current binding”](../../../apps/desktop/src/BindsPane.tsx#L253). [Recording a replacement](../../../apps/desktop/src/lib/binds-ui.ts#L418) emits the new bind but does not necessarily unbind the old key in `config.cfg` or another loaded CFG. TF2 can therefore retain both effective keys while execs displays one. This overlaps the existing [RND-218 binding expansion backlog](../../design/2026-09-22-overhaul/research/release-scope.md).

**Action:** Resolve all effective keys for an action, name their sources, and make replacement semantics explicit. On a deliberate replace, remove or override prior owned binds safely; never erase arbitrary user bindings without a review.

### B6. Global viewmodel visibility can contradict per-class Show

**P2 · Code-confirmed UX mismatch.** [Gameplay's Draw viewmodel](../../../apps/desktop/src/GameplayPane.tsx#L116) changes `r_drawviewmodel`; [Viewmodels' Show/Hide choices](../../../apps/desktop/src/ViewmodelPane.tsx#L116) and preview do not receive that effective global value from [SettingsHost](../../../apps/desktop/src/SettingsHost.tsx#L953). “Show” can be selected for every class while the global CVar hides all models. Existing [RND-225](../../design/2026-09-22-overhaul/research/release-scope.md) already identifies the broader visibility/FOV/transparent-viewmodel integration need.

**Action:** Put global visibility status beside per-class controls and route users to the owning setting; a shared viewmodel home is the longer-term design.

### B7. Accepted external packs can be invisible in Mods Installed

**P2 · Code-confirmed.** Absorb adds accepted external pack files to the profile, but [reconciles only existing `ModRecord`s](../../../apps/desktop/src-tauri/core/src/absorb.rs#L952). [Mods Installed](../../../apps/desktop/src/ModsPane.tsx#L457) lists records, and [remove_mod](../../../apps/desktop/src-tauri/core/src/mods.rs#L805) requires one. An accepted pack can switch and export with a profile while having no removable row in Mods.

**Action:** Synthesize a stable “external pack” record at acceptance, or display manifest-owned packs independently with a safe remove/review path.

### B8. One CFG inventory failure blocks unrelated panes

**P2 · Deliberate conservative behavior with a broad UX cost.** [SettingsHost reload](../../../apps/desktop/src/SettingsHost.tsx#L244) fetches all CFG files; an unreadable/oversized item or inventory limit can make [all setting writes unavailable](../../../apps/desktop/src/SettingsHost.tsx#L485), including Comfig, HUD, or Mods paths that do not need that specific editor content. Files limits are [bounded deliberately](../../../apps/desktop/src/lib/files-limits.ts#L6).

**Action:** Keep failure closed for settings whose effective CFG state is unknown, but split readiness by dependency and explain which file blocked which pane. Provide a direct repair route to the offending file.

### B9. Profile load failure can display stale values under a new name

**P2 · Code-confirmed; UI error fixture pending.** [SettingsHost retains old detail during reload](../../../apps/desktop/src/SettingsHost.tsx#L225), while [the header follows the selected profile ID](../../../apps/desktop/src/components/ReadyPanel/ProfileMenu.tsx#L135). If the new read fails, old values remain visible under the new profile label, though controls are blocked.

**Action:** Blank or visibly mark previous profile detail as soon as identity changes; render a bounded retry state under the new profile name.

### B10. Multiple HUD roots can unnecessarily disable other controls

**P2 · Code-confirmed design limit.** [Frontend CFG inference](../../../apps/desktop/src/lib/cfg-state.ts#L39) cannot identify which retained HUD root native code projected. With multiple HUD-like roots and CFG content, [SettingsHost disables Binds, Gameplay, Crosshair, and Sounds](../../../apps/desktop/src/SettingsHost.tsx#L1328) and recommends saving current setup, even when native has an explicit selected HUD.

**Action:** Return the projected HUD root/identity in the settings response and derive the startup model from that actual projection. Keep uncertainty only for genuinely ambiguous legacy installations.

### B11. Sounds shows managed state without other installed sound sources

**P2 · Code-confirmed provenance gap; native precedence pending.** [Sounds](../../../apps/desktop/src/SoundsPane.tsx#L95) receives its managed hitsound record, CFG text, and CVars. A [creator ZIP](../../../apps/desktop/src-tauri/core/src/zip/creator.rs#L400) can supply the same canonical `sound/ui/hitsound.wav` path through a custom pack, as can other imported mods. The pane does not report a competing mounted sound path, so “Default ding” or an execs record may not describe the audio TF2 uses. The [fixture capture](screenshots/19-sounds.png) shows the pane's single-source presentation.

**Action:** Include canonical hit/kill sound members in the shared virtual-path conflict index and label the record as managed provenance, with a conditional effective-source explanation until retail precedence is validated.

## C. Feature coverage and redundant entry points

### C1. HUD Editor crosshair controls are hidden

**P2 · Pinned upstream corpus verified.** The pinned [TF2HUD.Editor JSON corpus](https://github.com/CriticalFlaw/TF2HUD.Editor/tree/17bccd15d818d12707ce89574318acbc23c85a9f/src/HUDEditor/JSON) has 15 root JSON files: 13 HUD-specific schemas and two shared helpers. Eleven HUD-specific schemas have a `Crosshair` or `CustomCrosshair` control; all five HUD IDs effectively supported by execs do. [The app filters `Crosshair` controls](../../../apps/desktop/src-tauri/core/src/hud_apply.rs#L428), so a major author-provided feature is absent. [The author's control documentation](https://criticalflaw.ca/TF2HUD.Editor/json/controls/) describes the type. This is particularly confusing beside the separate Crosshair pane.

**Action:** Model HUD overlay crosshairs as a distinct source, then implement and validate that schema type where safe. Link its editing control from both HUD and Crosshair without making the two systems look identical.

### C2. A HUD background choice can be a silent no-op

**P2 · Pinned schema/code confirmed; UI click fixture pending.** [Pinned rayshud's `rh_val_main_menu_bg` ComboBox](https://github.com/CriticalFlaw/TF2HUD.Editor/blob/17bccd15d818d12707ce89574318acbc23c85a9f/src/HUDEditor/JSON/rayshud.json) uses only `Special: HUDBackground/StockBackgrounds` and parameters. [HudControl deserialization](../../../apps/desktop/src-tauri/core/src/hud_apply.rs#L33) omits `Special`; [apply logic](../../../apps/desktop/src-tauri/core/src/hud_apply.rs#L531) therefore has no payload operation. [Compatibility gating](../../../apps/desktop/src-tauri/core/src/hud_schema_compat.rs#L147) warns about unsupported `WriteFile`, not this control. The option can appear editable without changing background files. The [author's background documentation](https://criticalflaw.ca/TF2HUD.Editor/json/backgrounds/) confirms that `Special` carries the actual operation.

**Action:** Reject or visibly disable every schema operation that the parser cannot execute, with a reason per control. Implement the `Special` background operation only after validating exact file effects and recovery.

### C3. HUD schema coverage is narrower than the catalog

**P3 · Upstream corpus comparison.** [The app's schema whitelist](../../../apps/desktop/src-tauri/core/src/hud.rs#L46) lists six IDs, with m0rehud unavailable; five omitted pinned schemas overlap hud-db catalog entries: BerryHUD, e.v.e Plus, HExHUD, Community HUD Fixes, and SunsetHUD. This is a compatibility backlog, not proof they are safe to enable.

**Action:** Run each schema through the same file-operation compatibility harness, then enable supported controls or show a clear catalog-specific reason.

### C4. Viewmodel preload has two owners and an unused command

**P2 · Code-confirmed.** [Viewmodel draft defaults preload on](../../../apps/desktop/src/lib/viewmodel-ui.ts#L62) and [Build/Import passes it](../../../apps/desktop/src/ViewmodelPane.tsx#L283), but there is no Viewmodels control. The [native hook](../../../apps/desktop/src-tauri/core/src/viewmodel.rs#L42) adds an itemtest launch sequence, a meaningful startup effect. [Mods Casual exposes a preload toggle](../../../apps/desktop/src/ModsPane.tsx#L493), while [`setViewmodelPreload`](../../../apps/desktop/src/lib/bridge.ts#L825) exists in bridge/native/preview with no UI caller. The feature is shared, yet ownership and terminology differ.

**Action:** Present one shared preload status/owner and make both panes route to it. Remove or use the dormant API after a migration review; avoid duplicate switches that can disagree.

### C5. Transparent viewmodels repeats with inconsistent guidance

**P2 · Visual and code evidence.** [Onboarding](../../../apps/desktop/src/SetupWizard.tsx#L177), [Comfig](../../../apps/desktop/src/ComfigPane.tsx#L356), and [Gameplay](../../../apps/desktop/src/GameplayPane.tsx#L175) all expose the same addon. Shared state is appropriate, but only Gameplay explains DirectX/HUD compatibility and graphics tradeoffs; availability checks differ. The [readiness check](../../../apps/desktop/src/SettingsHost.tsx#L793) does not establish whether the selected HUD supplies its needed support. Compare [onboarding](screenshots/03-fresh-setup.png), [Comfig](screenshots/07-comfig-addons.png), and [Gameplay](screenshots/06-gameplay.png).

**Action:** Use one shared description and eligibility rule, with a single owner link wherever the addon appears.

### C6. Crosshair Build can succeed with incomplete weapon coverage

**P2 · Code-confirmed; malformed-script fixture pending.** [The builder skips individual scripts](../../../apps/desktop/src-tauri/core/src/crosshair.rs#L510) it cannot parse/patch and fails only when all fail. [Pane copy](../../../apps/desktop/src/CrosshairPane.tsx#L545) says it applies every weapon override. Requested assignments are not checked against the successfully patched stems before saving the record.

**Action:** Return skipped script names and requested-but-unbuilt weapons from core, present a partial result, and require review before claiming full coverage.

### C7. The Comfig module picker has two indistinguishable Defaults

**P3 · Captured visual/accessibility-label issue.** The post-processing module displays one “Default” for inheriting the preset and another for its literal `default` level ([Comfig selector](../../../apps/desktop/src/ComfigPane.tsx#L65), [catalog](../../../apps/desktop/src/lib/comfig-catalog.ts#L159)). Both use the same visible and accessible name in [the capture](screenshots/16-comfig-defaults.png).

**Action:** Name the first “Use preset” and the second “Module default,” with a short explanation of their actual values.

### C8. Mods Installed count omits active Casual modifications

**P2 · Captured UX gap; counts are internally consistent.** [The Installed tab](../../../apps/desktop/src/ModsPane.tsx#L271) counts only `ModRecord`s and shows **Installed 0** in the [fixture](screenshots/22-mods-installed.png). The same Mods pane shows [Preload On, three patched files, and applied particle sources](screenshots/23-mods-casual.png) under Casual setup ([source list](../../../apps/desktop/src/ModsPane.tsx#L657)). A user reading Installed as the total active mod inventory can miss substantial live changes.

**Action:** Rename the tab “Custom packs” or show an aggregate “Active changes” summary that includes Casual setup, with a clear source and repair route for each item.

## D. External connections, coverage, and source stewardship

| Connection | App use and boundary | Gap / current status |
| --- | --- | --- |
| GitHub/mastercomfig | Presets/addons, pinned comfig hits index, embedded guide; `net.rs` enforces host/path/redirect/size policy for native fetches | Current 9.100.1 digest contract matched on this audit date. Embedded remote guide has no IPC, but [window builder](../../../apps/desktop/src-tauri/src/commands/mod.rs#L51) lacks an explicit new-window handler and scheme check; offsite links need a native click test. [mastercomfig docs](https://docs.comfig.app/latest/) |
| hud-db / tf2huds.dev | HUD catalog, preview, exact matched statistics | [Catalog JSON uses a pinned tree SHA](../../../apps/desktop/src-tauri/src/hud_fetch.rs#L203), while [banner/screenshot paths use moving `main`](../../../apps/desktop/src-tauri/core/src/hud.rs#L56). Cached record and art can differ by revision. [hud-db repository](https://github.com/mastercomfig/hud-db) |
| TF2HUD.Editor | Pinned author schemas applied as data | Crosshair and `Special` operations have the coverage gaps in C1/C2; current pin matched repository head. [Author docs](https://criticalflaw.ca/TF2HUD.Editor/json/controls/) |
| GameBanana | TF2 game 297 Mod/Index and bounded download redirects | [Browse filters the entire GUI root 1644](../../../apps/desktop/src-tauri/src/gamebanana.rs#L495). [Live API](https://gamebanana.com/apiv11/Mod/Index?_nPage=1&_nPerpage=20&_aFilters[Generic_Game]=297&_aFilters[Generic_Category]=1644&_sSort=Generic_Newest) returned 2,689 GUI items on the audit date, including HUDs, portraits, and menus. hud-db covers only a subset. Eligible results need a safe HUD/manual-import route. |
| GameBanana download pages | Picks a file and follows official `/dl/` chain through bounded hosts | [Picker](../../../apps/desktop/src-tauri/src/gamebanana.rs#L639) may choose a newer VPK for a HUD although [HUD extraction](../../../apps/desktop/src-tauri/src/hud_fetch.rs#L433) requires ZIP/7z. [Example official download page](https://gamebanana.com/apiv11/Mod/461758/DownloadPage) has seven variants with descriptions; those details are dropped. Variant choice is already [RND-298](../../design/2026-09-22-overhaul/research/release-scope.md). |
| GitHub HUD showcase | Author `showcase.md` album lists | [Album cache has no expiry](../../../apps/desktop/src-tauri/src/hud_fetch.rs#L729); even Refresh can keep stale screenshot lists. |
| Dropbox / teamfortress.tv | HUD download hosts | Pinned origin/redirect and archive checks exist. No new generic remote IPC path was found. |
| Local Steam / TF2 | [Finds confirmed installs](../../../apps/desktop/src-tauri/core/src/finder.rs#L1), reads installed Valve VPKs, mirrors the Steam Cloud `config.cfg` copy, edits launch options only while Steam is closed, and opens `steam://` launch/verify links | These are local client/file interactions, not a direct Steam Cloud API. Cloud acknowledgement, retail TF2 search behavior, and packaged native paths remain qualification work. |
| Steam Game Coordinator | Development-only read-only Inventory helper via signed-in session | Product build keeps Inventory hidden/refused. [Valve GC API](https://partner.steamgames.com/doc/api/isteamgamecoordinator) describes message transport; [probe README](../../../tools/inventory-probe/README.md#L5) is stale about manual-only refresh versus current active-pane automatic refresh. |
| GitHub Releases/updater | Tauri signed update feed at the documented fixed URL | Separate from `net.rs`; existing release qualification remains open. This audit did not install or probe an updater. |
| CompVMInstaller, Venom, TF2Hitsounds, cueki | On-demand third-party behavior/assets; credits and pins | [THIRD_PARTY.md](../../../THIRD_PARTY.md#L17) records unresolved permissions for CompVMInstaller previews/animations, Venom textures, and TF2Hitsounds. Current pins for the checked repositories matched their heads; pin freshness does not grant usage rights. |

Native downloads use one bounded `net.rs` client with allowlisted hosts/paths, redirects, payload caps, and digest checks where available. The September 23 follow-up added a [connection-time resolver](../../../apps/desktop/src-tauri/src/net.rs) that refuses private or reserved DNS answers for direct download connections while retaining normal resolution for configured proxy hosts. A proxy still receives the destination hostname in `CONNECT` and can resolve it independently, so the public-DNS precheck does not bind that proxied target. This remains a **P3 hardening assurance gap**, not a demonstrated exploit with the current host allowlist and TLS; the [remediation tracker](remediation.md) keeps D8 open and records the direct/proxy fixtures. Live CDN redirects remain a separate qualification check.

Two integration decisions were verified against external guidance: `exec overrides/<stem>` matches [mastercomfig's quick fix](https://docs.comfig.app/page/next_steps/quick_fixes/), and the chosen custom crosshair material location is consistent with a [community weapon-crosshair guide](https://www.teamfortress.tv/30866/guide-weapon-specific-custom-crosshairs). These do not need speculative rewrites.

## Visual evidence and journey notes

The browser fixture was visited in this sequence: active Comfig; existing and fresh first-run; Binds; HUD browse; Gameplay; Comfig addons; App settings; Viewmodels; Files and an editable managed CFG; Launch; profile menu; Files draft to New profile; development Inventory; Comfig module defaults; Crosshair custom and weapon overrides; Sounds and its library; Mods Browse, Installed, and Casual setup; Crosshair pack explanation; and an unapplied switch to In-game mode. The Files draft correctly opened a named Save / Discard / Cancel guard; the audit draft was cancelled and discarded. The Crosshair mode change correctly identified an unapplied draft, blocked Launch, and offered Use/Cancel; Cancel returned the fixture to its prior state. These captures show interface state and wording, not actual native file writes.

| Step | Capture | Audit use |
| --- | --- | --- |
| 01–03 | [Comfig](screenshots/01-comfig.png), [existing setup](screenshots/02-existing-setup.png), [fresh setup](screenshots/03-fresh-setup.png) | Entry and shared addon journey |
| 04–07 | [Binds](screenshots/04-binds.png), [HUD](screenshots/05-hud-browse.png), [Gameplay](screenshots/06-gameplay.png), [Comfig addons](screenshots/07-comfig-addons.png) | Single-binding claim, overlapping controls |
| 08–11 | [App settings](screenshots/08-app-settings.png), [Viewmodels](screenshots/09-viewmodels.png), [Files](screenshots/10-files.png), [editable managed file](screenshots/11-managed-file.png) | Shared viewmodel state and managed-file contradiction |
| 12–16 | [Launch](screenshots/12-launch.png), [profile menu](screenshots/13-profile-menu.png), [draft guard](screenshots/14-unsaved-guard.png), [dev Inventory](screenshots/15-inventory-dev.png), [duplicate Defaults](screenshots/16-comfig-defaults.png) | Cross-pane flow, guard, development scope, label issue |
| 17–20 | [Crosshair custom](screenshots/17-crosshair-custom.png), [weapon overrides](screenshots/18-crosshair-overrides.png), [Sounds](screenshots/19-sounds.png), [sound library](screenshots/20-sounds-library.png) | Crosshair source claim, sound source choices |
| 21–24 | [Mods Browse](screenshots/21-mods-browse.png), [Installed](screenshots/22-mods-installed.png), [Casual setup](screenshots/23-mods-casual.png), [Casual selections](screenshots/24-mods-casual-selection.png) | GameBanana taxonomy, installed record, shared preload and particle controls |
| 25–26 | [Crosshair pack explanation](screenshots/25-crosshair-about-pack.png), [In-game mode draft](screenshots/26-crosshair-in-game.png) | Crosshair-source limits and correctly guarded mode transition |

This visual pass inspected labels and screenshots but did not run NVDA/Orca, keyboard-only native dialogs, or a measured contrast audit. The duplicate “Default” accessible names are observable in the fixture; broader accessibility conformance remains part of candidate qualification.

## Suggested integrated repair sequence

1. **Protect live bytes and exact switching.** Resolve A1/A2 with transition fixtures and a pending-live-handoff model. Make A3 reject unrelated VPK members. These are the clearest trust/data-integrity concerns.
2. **Stop silent setting loss.** Preserve unknown crosshair values (B1), define safe Binds ownership (A4/B5), and make Sounds apply one coherent state (A7). Verify both saved bytes and visible controls after a failed command.
3. **Create a shared read-only source index.** Enumerate profile/installed loose files and bounded VPK members by normalized virtual path; include CFG/Launch and selected HUD projection metadata. Feed Crosshair, Mods, HUD, Viewmodels, and Sounds from the same conflict facts. Report “installed winner” separately from map/server-dependent behavior. This addresses B2/B3/B4/B6/B7/B10 without adding competing editing surfaces.
4. **Make feature records truthful.** Bind records to payload hashes (A5/A6); disclose partial Build results (C6); show any accepted external pack in Installed (B7).
5. **Reconcile HUD schema and catalog coverage.** Hide unsupported `Special` options with an explicit reason, then implement tested operations; add HUD crosshair as its own source (C1/C2). Revisit GameBanana GUI discovery and file-variant selection with the existing RND-298 scope.
6. **Polish shared journeys.** Consolidate viewmodel/preload and transparent-addon guidance (B6/C4/C5), isolate per-pane readiness and profile-load placeholders (B8/B9), and fix the duplicate Comfig labels (C7).

Minimum cross-feature acceptance fixtures: Keep-then-switch with unique/conflicting VPK names; delete-active-then-switch; VPK-with-CFG Viewmodel import; external `cl_crosshair_file` followed by color edit; crosshair script and mod VPK containing the same member; editable managed binds with custom lines and config drift; double-key rebinding; sounds second-command failure; rayshud `Special` option; supported HUD crosshair option; retained multi-root HUD with known projection; external accepted pack in Mods Installed. Native TF2 validation should then compare the app's source explanation with `path`, loaded CFG behavior, at least one HUD overlay, a weapon-script collision, and a server with applicable `sv_pure` rules.

The existing [release scope](../../design/2026-09-22-overhaul/research/release-scope.md) already names RND-215 (one HUD), RND-218 (bindings), RND-225 (viewmodel home), RND-229 (particle winners), RND-298 (download variants), and RND-251/RND-324 (native and engine qualification). The findings above should be triaged against those issues before opening duplicates. Inventory remains development-only and outside the selected 0.2.0 commitment; this audit did not turn it into a release requirement.
