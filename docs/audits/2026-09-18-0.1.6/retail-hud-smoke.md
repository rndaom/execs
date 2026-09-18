# Retail HUD smoke: isolation failure, restored

Candidate `a83f96be89869a8c6c8fc6e2a3ff7fee6145d8cc`, Windows retail TF2
build `10828683`, September 18, 2026. This is **not a passing gameplay or
visual verification gate**.

## Prepared data

A disposable Rust generator linked the candidate `execs-core`, extracted the
pinned HUD archives, parsed/adapted their pinned TF2HUD.Editor schemas, and
applied four configurations:

- HypnotizeHUD: all six checkbox-controlled base includes off, then on.
- kbnhud: crosshair 1 / crosshair 2 / hitmarker sizes 13 / 17 / 23, with
  outlines true / false / true, then the inverse outline selections.

All four generated trees passed repeated-apply byte idempotence. Outputs
contained 959 HypnotizeHUD files and 849 kbnhud files. Input bytes remained
unchanged; local evidence records each output file hash and selected options.
The generator wrote only disposable evidence directories.

| Input | SHA-256 |
| --- | --- |
| HypnotizeHUD archive, API zipball for `82d332540a82ab085ff1a14b9aef774982ac5b9e` | `07d4385993349514150e4fc94a3068207d90e9d589225a68d1e90aef985ac246` |
| HypnotizeHUD schema | `44eafa23a59a71dd577bb69db04a1f143d92f464c24333a07d7a371f20851abb` |
| kbnhud archive | `829e58d87556555a1ad7b6da088f5c76252955fc64e75b0fc754d34c84c6e15f` |
| kbnhud schema | `e41144032f6bc198b0c6de31b667fb10592a5be34fcabd9c8dfabf5f1c8adf40` |

Schema revision: `17bccd15d818d12707ce89574318acbc23c85a9f`. The
HypnotizeHUD API zipball and the codeload ZIP documented in the import audit
have different wrapper names/archive hashes; all 959 payload files were
independently compared and are byte-identical after wrapper removal.

## What happened

Only the first HypnotizeHUD configuration was launched. A disposable `-game`
root mounted its own HUD, cfg, download and platform write directories, with
installed stock assets available as read fallbacks. The process used `-novid`,
`-condebug`, a smoke cfg and `+quit`; no video flags, security settings or
registry settings were changed. A 45-second bound applied to that process.

TF2 exited normally with code 0. Console evidence confirms the fixture HUD
mount, completion marker and Hypnotize Icons V8 fonts. These observations
establish bootstrap/font loading only, not actual gameplay panel sizes,
outlines or visibility.

The protected-state check then detected that TF2 had copied its disposable
configuration into the player's Steam Cloud `440/remote/cfg/config.cfg`.
**`-game` and isolated filesystem write paths do not isolate Steam Cloud.**
The run failed its isolation gate and no remaining cases were launched.
Other protected files and Source settings registry values did not change.

## Local recovery and verification

The unchanged real install's `tf/cfg/config.cfg` matched the pre-run Cloud
hash exactly. With TF2 stopped, the coordinator restored Cloud atomically
from those verified bytes and preserved the changed fixture bytes only in
local evidence. The restored SHA-256 equals the pre-run SHA-256:

`b8e8626f28bd76b548711b9208cc873387d877de628a25d51063a46fb3c34e67`

An independent read-only recheck at `2026-09-18T13:57:27Z` verified:

- All 369 protected file hashes match their pre-run values, including Cloud.
- All captured Source settings registry values match their pre-run values.
- TF2 is no longer running.
- The external launch script has an unconditional refusal at entry and is
  quarantined against reuse.

## Remote Cloud recovery verified

A subsequent read-only inspection establishes that the fixture configuration
was uploaded remotely, not merely written to the local Cloud directory:

- Steam's Cloud log at 09:55:41 local time records `Need to upload file cfg/config.cfg`.
- At 09:55:42 it records a successful HTTP upload of 2,283 bytes.
- At 09:55:43 it records `Upload OK for file cfg/config.cfg` and
  `Upload complete, result OK`.
- At that point `remotecache.vdf` recorded change number 61 and SHA-1
  `fbeb13783a547ae29e2a33ada8874ca9b0114ec0`, matching the preserved fixture
  configuration. The restored local original has SHA-1
  `490495dd55b03e5c25041e6c884476ee18880e18`.

The coordinator then wrote the exact original bytes through the documented
Steam Remote Storage `FileWrite` API using the installed official Steam API
library, without launching TF2. API readback matched the original SHA-256.
At 10:00:29 local time Steam logged `Upload OK for file cfg/config.cfg` and
`Upload complete, result OK`. A fresh read of `remotecache.vdf` records change
number 62, 4,389 bytes, sync state 1 and the original SHA-1
`490495dd55b03e5c25041e6c884476ee18880e18`.

Local and remote recovery are now verified. A final independent read-only
recheck again found all 369 protected file hashes and captured Source registry
values unchanged, with TF2 stopped. The sanitized machine-readable result is
[retail-hud-restoration.json](retail-hud-restoration.json). No additional game
launch or Steam setting change was needed.

Local evidence is under
`G:/Projects/execs-016-evidence/retail-hud/hypnotizehud-off/`:
`result.json`, `console.log`, `protected-before.json`, `protected-after.json`,
`cloud-restoration.json`, `cloud-api-restoration.json`, and
`restored-state-verification.json`. Player cfg
contents and local account paths are not included in this repository report.

This audit performs no further retail runs. A future method must
establish Cloud isolation separately; a successful bootstrap or unchanged
local cfg alone is insufficient. Gameplay/visual acceptance remains unproven.
