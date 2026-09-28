# Comfig issues 3 and 9: plan

## Evidence and boundaries

The current Comfig state defaults to Medium even without a loader. The native batch installer adds the base VPK without migrating vanilla autoexec/class cfgs. Addon downloads always use latest metadata; saved bases can be older. The issue explicitly permits an interim gate until reviewed cfg migration exists.

Official sources checked September 28, 2026: https://docs.comfig.app/latest/setup/install/ requires moving autoexec, listenserver and class cfgs into overrides; helper exec paths need adjusting if moved. https://docs.comfig.app/latest/customization/custom_configs/ documents setup_hook preset selection. These show why an automatic partial move would be unsafe.

## Proposed implementation

1. Reproduce the vanilla loader transition with disposable native fixtures. Gate every Comfig write in native core on the detected supported library loader, with active live-loader consistency. Gate before host downloads/pickers too. Vanilla pane shows no selected preset, explains existing cfgs must be reviewed/moved to overrides, and disables installation, presets/modules/addons/import. Use the permitted interim safety gate rather than an incomplete migration.
2. Store an optional release record in ProfileManifest: validated tag and exact base/addon path-to-sha256 identities. Old manifests deserialize without it. Existing unknown packages remain usable, with unknown version shown. Wizard creation and package updates persist this record inside the same existing transaction as bytes. Return valid record identity through ComfigState only when installed manifest hashes still match, so absorb/external changes cannot retain a false identity.
3. Addons fetch the recorded release by tag (strict bounded tag validation), verify current base/all retained addon identities against that release metadata, and commit new addon record and bytes together. Unknown/mixed package versions refuse new addon additions with guidance to Update packages; removals remain possible. Never silently update the base from an addon toggle.
4. Add a read-only release check command. UI checks on Comfig mount and on explicit retry, displays installed version / unknown, latest version and update availability; failed checks retain a clear unknown state and do not block local controls. Reject stale profile/revision responses and stale downloads. Package updates update only this profile and disclose that.
5. Keep existing flat pane sections, text styles, buttons and motion. Use a bounded state effect for checks; no new design system or global updater behavior.

## Validation

Core tests: vanilla autoexec/class fixture transition reproduction and no-mutation gate; live/library loader mismatch; TF2 lock first; old manifest round trip; version hash invalidation; release metadata atomic with package batch and addon removal; wizard version capture. Host tests: strict tag/asset release URL matching, missing/incorrect digest and retained identity mismatch, same-version addon asset selection. UI tests: vanilla no selected Medium and blocked writes, installed/unknown/update/failure copy. Targeted tests, TypeScript/Biome, Rust formatting and relevant core/host tests; root owns full-suite verification and final changelog/architecture edits.

No player files, app version, release tags, commits or pushes are changed by this workstream.
