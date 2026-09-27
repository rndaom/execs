# Visual audit coverage

Completed 22 September 2026. The browser pass saved 67 screenshots; 66 are accepted and one overscrolled duplicate is excluded. The primary agent inspected captures during the walkthrough; a second reviewer independently inspected representative evidence and the concept boards. The gallery groups the exact saved images and keeps their notes beside them.

| Surface | Accepted captures | States represented |
|---|---:|---|
| Comfig | 4 | Preset, all presets, expanded modules, networking/addons |
| Binds | 2 | Mapping grid, active key recording |
| Gameplay | 2 | Core controls, advanced controls |
| HUD | 8 | Catalog, ranked sort, import choice, installed HUD, expanded options, Minmode selected |
| Crosshair | 4 | Custom mode, in-game mode, designer, per-weapon overrides |
| Viewmodels | 2 | Scout and Soldier selections |
| Sounds | 3 | Hit/kill slots, source library, filtered results |
| Mods | 8 | Shipped Browse/Installed/Casual views, search/loading/results, import/removal, particle choices |
| Files | 10 | Editor, action menu, Problems, Help, new cfg/helper, warning source, dirty/completion, transition guard, Find |
| Launch | 1 | Options and Copy guidance |
| Setup, profiles and recovery | 15 | Empty/single/multiple installs, existing/unused setup, creation, profile menu, import trust/flags, absorb, switch, folder repair |
| Updates and shared states | 5 | Release notes, update offered/downloading, game-running lock |
| Inventory | 2 | Development-only grid and selected item |

Counts are gallery groups, not a claim that every possible option combination has been exercised. Capture 057 is a valid ordinary Comfig view reached through the import fixture, **not an observed import-success state**. Capture 043 is excluded. Source-level coverage remains in [the surface inventory](research/surface-inventory.md).

## Baselines and method

- Most captures use the working development frontend at commit `9ac45a3847b65da087661b1c08cf719fc6b9df11` with documented `?preview=` fixtures.
- Mods uses the existing 0.1.8 release worktree because the working branch predates the shipped Mods redesign. The release research verifies its frontend against public v0.1.8. This prevents recommending an obsolete Mods structure.
- Screenshots use the browser's normal 1280 × 720 viewport. They were saved before review and were not retouched. Scroll positions, open disclosures and fixture limitations are recorded in the ledger.
- Browsing, edits, imports and confirmations were exercised only against browser fixtures. The audit did not launch TF2, apply a real profile, alter Steam Cloud, run an updater, or perform a native game-file write.

## Additional shared-state findings

The completed walkthrough supports two refinements beyond the representative pane critique:

1. **Keep transient status from moving the workspace.** Comparing [HUD controls](audit/066-hud-controls-visible.png) with [a newly edited Minmode](audit/067-hud-minmode-selected.png) shows the pending-change header occupying extra height. Preserve the launch guard while giving its status a stable place; ordinary autosave feedback should not repeatedly shift the form. This is a visual observation, not a timing benchmark.
2. **Use intentional initial focus for consequential dialogs.** The captured repair and removal flows present their action prominently; the accessibility walkthrough initially focused the confirming action. The redesign should give destructive decisions a safe default focus and clear target, preserve Escape/Cancel, and restore focus to the invoking control. Do not infer implemented focus behavior from a PNG alone.

## Explicit remaining checks

Native OS file/folder pickers, separate external-guide webviews, real sound audition, installed VPK sprite extraction, Windows viewmodel compilation, actual Steam account inventory, real network failures, native close handling, Linux/WebKit rendering and updater installation need a later native qualification pass. Long text, high DPI, display scaling, keyboard-only navigation throughout the product and screen-reader semantics also require testing the selected implementation. Browser fixtures cannot certify those behaviors.

The proposed settings and deletion screens have no current implementation to screenshot. They are marked Planned in all three concept suites. Inventory is shown for visual consistency but remains development-only and outside the combined release commitment.
