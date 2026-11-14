# Pinned schema regression excerpts

`rayshud-duplicate-controls.json` and `kbnhud-duplicate-controls.json` contain
unaltered control records (grouped by duplicate name for the test) from
CriticalFlaw/TF2HUD.Editor commit `c87968920fdfa289018b43de6fca69e08c8f988e`,
`src/HUDEditor/JSON/{rayshud,kbnhud}.json`.

These MIT-licensed data excerpts verify exact duplicate normalization and are
test fixtures, not replacement runtime schemas. Runtime schemas remain fetched
from the pinned upstream. Upstream project and license attribution are recorded
in the repository's THIRD_PARTY.md.
# Stale alternate-model filename

`rayshud-streamer-mode.json` preserves the pinned Streamer Mode control. Its
red scoreboard list incorrectly nests `wide`/`false` below `labelText`; exact
fingerprint normalization restores the same `wide` true/false instruction as
the blue list. Both installed SectionedListPanels declare width 270.

`rayshud-alternate-player-model.json` is the exact Alternate Player Model control
from the same pinned MIT schema. Its nonexistent `hudplayerclass_left.res`
FileName is redundant with its complete direct `Files` instructions. The
normalizer removes only that exact pinned record's stale filename; both states
continue to edit the loaded model and disguise resources.

# Renumbered profile choices

`budhud-youtuber-profile.json` is the exact YouTuber Profile control from the
same pinned MIT schema. Upstream renumbered its choices; the adapter keeps the
values that saved profiles already hold, so a stored choice selects the same
profile folder as before.
