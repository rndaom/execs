# Pinned schema regression excerpts

`rayshud-duplicate-controls.json` and `kbnhud-duplicate-controls.json` contain
unaltered control records (grouped by duplicate name for the test) from
CriticalFlaw/TF2HUD.Editor commit `17bccd15d818d12707ce89574318acbc23c85a9f`,
`src/HUDEditor/JSON/{rayshud,kbnhud}.json`.

These MIT-licensed data excerpts verify exact duplicate normalization and are
test fixtures, not replacement runtime schemas. Runtime schemas remain fetched
from the pinned upstream. Upstream project and license attribution are recorded
in the repository's THIRD_PARTY.md.
