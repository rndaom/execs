# RND-324 — startup investigation and bounded improvement

Status: **partial implementation; issue remains open**. Evidence date: 2026-09-22. This is not a clean-launch, Casual-compatibility or frame-presentation qualification result.

## What changed

`core/src/viewmodel.rs` still produces the established offline `itemtest` preload. The generated cfg now explains that it opens that map and returns to the menu, advises launch-only use, and logs the hook boundaries without asserting that content cached successfully. It no longer clears console history or calls the server-side `script_execute randommenumusic` after disconnect. The original bounded command-buffer delay remains; it is not labeled an initialization barrier.

The launch-option replacement recognizes quoted filenames and the optional `.cfg` suffix in addition to both managed stems. Replacing or disabling an existing selection therefore removes duplicate managed spellings while preserving unrelated `+exec` commands. This is launch-token normalization, **not a runtime once-only guard**. Re-executing the cfg manually or from another user cfg can still run it again.

Casual setup explicitly discloses the offline-map behavior. The improved cfg is emitted when the managed preload is generated or rewritten through existing operations; this change does not rewrite every saved profile on application startup.

## Primary-source findings

- The preloader author's mechanism documentation explicitly describes offline-map preloading as part of its combined mechanism. Its VGUI caching section concerns retaining texture references through offscreen HUD resources; it does not establish a replacement for all model, animation and particle initialization. No GPL implementation code was copied. [casual-pre-loader mechanism documentation](https://cueki.github.io/casual-pre-loader/how_it_works/)
- Valve's command buffer treats `wait` as a tick delay only when waiting is enabled. It neither observes successful map initialization nor provides an error branch. Adding another wait or an alias loop would not establish the requested bounded once-only startup condition. [Valve command buffer, pinned source](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/tier1/commandbuffer.cpp#L194)
- The shared `script_execute` server command refuses work without its script VM. The server script system creates that VM during level initialization and destroys it during level shutdown. Calling it after disconnect is not a reliable menu-music restart. [Valve shared VScript commands](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/shared/vscript_shared.cpp), [Valve server VM lifecycle](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/server/vscript_server.cpp#L3712)
- Valve's server interface performs precache work during level initialization. This supports caution about replacing the current map lifecycle with a speculative client command; it is not proof that no alternative implementation is possible in retail TF2. [Valve level initialization](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/game/server/gameinterface.cpp#L902)

The public SDK is evidence for command semantics, not a runtime trace of the user's installed TF2 build. The generated concept art and the issue's desired behavior cannot establish an engine capability. Deleting required preloading to make the console quieter would regress the first acceptance criterion. Substituting `map_background`, hiding warnings, or claiming an echo means success would not satisfy the criteria either.

## Acceptance still unresolved

| Requirement | Current evidence |
| --- | --- |
| Supported `+exec overrides/execs_preload`, active-profile content | Both cfg layers and existing projection paths retained; fixture verification required with integrated profile work. |
| No avoidable missing-`itemtest.cfg` warning and no implicit map/disconnect cycle | **Unresolved.** Offline map remains explicitly disclosed. No extra map cfg or new live write target introduced. |
| Once after initialization; no re-entry | Managed launch spellings deduplicated, generated cfg has no recursive exec/alias. **Runtime initialization and external re-entry remain unproven.** |
| Clear failure with no temporary-server residue | Console errors preserved and hook boundaries identifiable. **Cfg cannot detect map success, wait availability or failed cleanup; native failure behavior remains unqualified.** |
| Clean launch, short PresentMon, unchanged fullscreen/D3D9Ex independent flip | **Not performed.** No TF2 launch, player-state write, Cloud mutation or presentation capture performed by this agent. |
| Profile-owned selection compatibility | No manifest, selection or projection schema changes in this patch. |

## Verification

- Generated-cfg regression keeps one itemtest invocation and the established preload cvars, preserves console evidence, and rejects recursive exec/alias, console clearing and post-disconnect VScript commands.
- Launch normalization regression covers duplicate bare, quoted and suffixed spellings; unrelated exec preservation; idempotent updates; and both vanilla/comfig layers.
- All 19 viewmodel fixture tests passed in the HUD agent's integrated core run after correcting concurrent HUD manifest normalization (`hud_roots: None` versus `Some([])`). This includes existing import, rollback, live drift, game-running and Steam launch-sync fixtures as well as the new serializer/token regressions. It is not a retail-game launch.

Next engine work requires a verified alternative mechanism or a revised explicit preload workflow, plus native clean/failure/re-entry traces in an independently isolated test setup. Qualification must not set video flags or assume an isolated `-game` directory protects Steam Cloud. The recurring in-game FPS issue is not proven to be caused by this startup hook.
