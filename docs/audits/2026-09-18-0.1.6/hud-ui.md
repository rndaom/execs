# HUD browser interaction checks

The maintenance candidate's `settings-hud-installed` browser fixture was
checked on September 18, 2026. No native game or player files were touched.

- The options disclosure expands. Space toggles Minmode; Tab and Right select
  the Minimal scoreboard option.
- Entering 99 in Ubercharge flash and blurring clamps the value to 30.
- A pending HUD draft temporarily guards Launch TF2 and exposes Review changes;
  the preview autosave resolves the draft and enables launch again.
- A temporary in-memory unavailable control exercised the actual `HudPane`
  renderer. Its full guidance was visible in the DOM, it had no interactive
  descendants, and Tab skipped it. Previously saved values are described as
  retained but unapplied.
- At the measured 1920×889 viewport there was no horizontal overflow. The
  unavailable guidance occupied a 380×116 box without width overflow.

Screenshot capture timed out twice. A requested 960×640 override did not change
the measured viewport, so no screenshot or minimum-window visual acceptance is
claimed. These are browser interaction/DOM checks, not native screen-reader
speech or TF2 rendering checks. Reloading removed temporary fixture additions
and edits. Local raw evidence remains in
`G:/Projects/execs-016-evidence/hud-ui/`.
