# Files native save and creation evidence

Scope: RND-317 and RND-321 native work, based on public 0.1.6. No tag,
installer, public release, real game launch or real player cfg mutation.

## Contract

`get_files_context` returns the active profile, confirmed root and verified
manifest loader. `read_profile_file` returns current live bytes for editable
cfgs, exact SHA-256 identities for both live and library sources, and context.
Provided pack cfgs read their library bytes. A missing live cfg has a null
live hash; invalid UTF-8 remains binary/read-only. A library hash that differs
from its manifest fails closed rather than becoming a new approved baseline.

`write_owned_file` requires all of that source identity. Under `WriteGate`,
the core checks profile, root, library/live loader and both actual byte hashes.
It rechecks byte identities and destinations after transaction snapshots and
the final process sample, immediately before journal publication. Existing
transaction checks protect changes after snapshots. There is no force flag.
The returned manifest hashes acknowledge precisely the submitted bytes;
clients must not acknowledge an unrelated subsequent read as that save.

New files require expected absence in both trees, including orphan library
files, and use the existing profile mutation journal, manifest and live
projection. Paths use the portable profile validator, plus current layer,
`.cfg`, managed/stock-name and case-collision checks. Nested manual helpers
are supported. No startup link is inserted. No schema or write root changes.
`config.cfg` keeps the existing Cloud dual-write and pending retry behavior.

The targeted live loader check enumerates bounded custom children and reads
only startup candidates and bounded VPK entries. It shares the existing loader
parser and mount ordering, without walking or hashing unrelated mod assets.

## Evidence

Passed on Windows:

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs-core --lib --locked --quiet`: 656 passed, 6 explicitly ignored installed-asset/opt-in tests.
- Focused `files_workspace` tests: 13 passed.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs-core --all-targets -- -D warnings`.
- `cargo fmt --all --manifest-path apps/desktop/src-tauri/Cargo.toml --check` and `git diff --check`.

Windows local disposable core fixtures cover 13 focused cases: empty-profile
creation; nested helper and heavyweapons destinations; stale/queued saves;
external edits/deletions; profile/root/loader changes; running-game refusal;
portable names and live/library case collisions; orphan library bytes;
provided cfg refusal; binary/size limits; verified mastercomfig loader removal;
Cloud failure and absorb retry; interrupted creation rollback/retry; unchanged
library bytes deliberately restored live; save-preparation external edits and
creations; unchanged schema export/import round trip; targeted loader parity.

Research: the [Files audit and delivery plan](https://linear.app/rndaom/document/files-workspace-deep-audit-research-and-017-rework-plan-73e3e612b655),
repository release playbook, existing apply/profile transaction/Cloud fixtures,
and [mastercomfig custom config documentation](https://docs.comfig.app/latest/customization/custom_configs/)
(retrieved September 20 UTC, 2026) establish layer and class naming behavior.

Integration UI/visual verification, packaged IPC execution, Linux and native
accessibility qualification belong to the combined release readiness evidence;
these native fixtures alone do not establish those outcomes.
