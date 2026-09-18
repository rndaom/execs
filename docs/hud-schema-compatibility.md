# HUD schema compatibility

The option schema remains pinned to TF2HUD.Editor commit
`17bccd15d818d12707ce89574318acbc23c85a9f`. Cached and newly downloaded
schemas pass the same validation and adapter before use.

- **HypnotizeHUD (RND-307):** hud-db uses `hypnotizehud`; older records may use
  `hypnotize-hud`. Both resolve the same schema and catalog update. An update
  retains the stored alias so it does not implicitly rename the installed tree.
- **m0rehud (RND-308):** the available schema is for m0rehud Classic. The audited
  catalog revision `4f00092352c34d3317e195db5a5c414b0143a898` lacks the required
  top-level customization assets, and the schema duplicates
  `mh_ammo_uber_style` for unrelated controls. Options are unavailable with
  guidance to the author, including for matched imports. Existing values are
  retained. An update requiring their reapplication refuses before installation;
  it cannot silently claim they were applied. No missing assets or ID migration
  are invented. All schemas reject duplicate top-level control names, while
  combo choices can remain unnamed as upstream specifies.
- **FlawHUD (RND-309):** `WriteFile` is a log-based editor integration, not an
  ordinary HUD-root file write. These controls remain visible with an unavailable
  explanation. Their old values survive saves and updates but are not applied;
  attempts to change them through IPC fail before the transaction. No cfg write
  target is added. This applies to every `WriteFile` control, including options
  nested in choices, rather than only the crosshair toggle.
- **kbnhud (RND-312):** the two size controls copied from crosshair 1 are corrected
  to `CustomCrosshair2` and `HitMarker` in their respective resources. Control IDs
  and saved values remain unchanged. The adapter requires the exact pinned old
  target (or its corrected form), so unexpected upstream edits fail explicitly.

Primary evidence:

- [Editor control contract](https://criticalflaw.ca/TF2HUD.Editor/json/controls/)
- [Pinned kbnhud schema](https://github.com/CriticalFlaw/TF2HUD.Editor/blob/17bccd15d818d12707ce89574318acbc23c85a9f/src/HUDEditor/JSON/kbnhud.json)
- [Pinned m0rehud Classic schema](https://github.com/CriticalFlaw/TF2HUD.Editor/blob/17bccd15d818d12707ce89574318acbc23c85a9f/src/HUDEditor/JSON/m0rehud-classic.json)
- [Audited m0rehud revision](https://github.com/Hypnootize/m0rehud/tree/4f00092352c34d3317e195db5a5c414b0143a898)

The unit regressions check identity rejection, alias resolution, exact corrected
targets, repeat adaptation, unavailable presentation metadata, unchanged resource
bytes, preserved saved values and rejected unsupported edits. These assertions
do not constitute an in-game rendering check. The release candidate must also
exercise the engine's full-apply tests with three distinct sizes and perform the
planned TF2 check before release.
