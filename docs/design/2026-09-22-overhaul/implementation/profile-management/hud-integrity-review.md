# HUD ownership integrity review

Independent read-through of the RND-215 ownership implementation, including the profile transaction, HUD replacement, native command gates, legacy profile loading, Mods removal, switch/absorb checks, and profile ZIP review/import. This complements the implementing agent's regression fixtures; it is not release qualification.

## Findings addressed

- Recovery reads the original serialized manifest without deriving HUD metadata first. This preserves journal comparisons and permits recovery when a HUD metadata file is temporarily in a transaction backup. Public reads and completed mutations derive validated roots separately.
- An ownership choice is bound to the reviewed manifest and exact candidate payload hashes. The source fingerprint is checked again after rollback snapshots are staged, immediately before journal publication.
- Active HUD replacements compare every touched managed HUD cfg and autoexec destination against the saved manifest, both before preserving originals and in the final transaction check. Handwritten live-only changes, missing saved files, and untracked destinations refuse replacement rather than being overwritten.
- Replacement matches prior HUD roots without case sensitivity. The original library payloads receive hash-bound recovery copies before removal, and active live trees use the existing excluded-container rename journal.
- Live inventory errors and non-regular metadata files fail closed. Case-colliding live HUD roots require source repair instead of collapsing two originals into one candidate. Candidate reading observes the cumulative memory budget while reading each tree.
- Source-signature HUD VPKs are refused on the relevant mutation paths, with the original bytes retained and an explicit extracted-folder import route. VPK inspection is bounded; it does not modify game archives.
- Multi-HUD imports retain the reviewed cfg and HUD payload bytes. When selecting a different owner would make existing managed options obsolete, the inactive profile records pending ownership review. Activation waits for the explicit reset/replacement transaction; the review names the affected managed cfg files.
- Removing a legacy selected HUD through Mods atomically clears its HUD record and selected root. If another preserved root remains, it requires ownership review rather than silently promoting that root. The selected-particle-source removal guard remains intact.

## Focused evidence

The implementing agent added fixtures for stale review evidence, changes during staging, uppercase roots, unreadable metadata, legacy HUD VPK refusal, old journal recovery, preserved import bytes with pending option reset, and live cfg edits. The live case-collision fixture is Unix-only and requires Linux execution.

The independent profile-management work also verified the legacy HUD ModRecord removal regression, all 9 profile deletion fixtures, all 5 native profile/preloader orchestration fixtures, and 31 profile hook/import/deletion frontend tests. Exact command coverage and browser evidence are recorded in [verification.md](verification.md).

All native verification uses disposable fixtures. No player library, live Steam session, TF2 process or Cloud configuration was used. Integrated Windows/Linux checks and installer qualification remain separate from this review.
