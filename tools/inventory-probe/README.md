# Inventory development

The development app's **Inventory** pane connects through the existing signed-in
Steam client. Read sessions return an account-bound snapshot and disconnect.
Separate reviewed operation sessions support backpack moves, four basic metal
conversions and one-item deletion. These native operations are implemented for
development testing; live Windows/Linux and packaged qualification remains pending.
The pane supports 50-slot pages, sorting, page jumps, search,
quality filters, and item details. It refreshes on first visible, focused use,
every two minutes while visible and focused, and after TF2 closes. Reads pause
while the app is hidden, unfocused, busy, or in-game; failed connections back
off from 30 seconds to five minutes. A failed read keeps the last snapshot
marked stale and offers Retry. Refresh backpack also starts a manual read.

The sidebar entry is excluded from production frontend builds. Release native
commands and the helper entry point also refuse inventory access. The owner requested
this manager for 0.2.0; live/platform acceptance and a new candidate remain required.

## Architecture

- `src/native.rs` and `src/protocol.rs` implement the Steam session and minimal
  protobuf fields. No JIM code or assets are copied.
- The debug desktop executable invokes itself with `--inventory-read` before
  Tauri initialization. The child owns Steam environment variables, callbacks,
  and SDK shutdown. The parent serializes connection attempts with the native
  write gate and terminates a hung helper after 40 seconds.
- Ordinary reads send only ClientHello and account-bound SOCacheSubscriptionRefresh.
  The separate `--inventory-operation` entry point takes bounded typed stdin from
  a parent that has persisted the reviewed intent. It sends exactly one move batch
  (1100), explicit metal craft (1002), or one-ID deletion (1004), then reads a fresh
  complete cache. It does not implement equip, trade or tool-use operations.
- Operations repeat the account, complete baseline, protected-ID, collision and
  game-closed guards before sending. The pre-send SDK queue is drained. Confirmation
  requires a newer account-bound complete cache and exact expected changes, including
  unchanged unrelated raw item bytes. Craft also requires a successful matching
  response; delete requires the matching destroy event. All post-send errors are
  unknown outcomes, never automatic retries. The parent owns review and journaling.
- The operation session ends within 45 seconds and reads at most 32 MiB of stdin.
  `reconcile_operation` can compare a persisted intent with a later complete snapshot
  without sending anything; an unchanged snapshot cannot prove a write was refused.
- The signed-in persona name and avatar are read through Steam Friends and Utils
  in the same bounded helper session. Missing presentation data remains optional;
  avatars cross IPC as bounded PNG data URLs, with no web-profile request.
- Item attributes retain their exact value bytes (or legacy little-endian uint32)
  for local schema interpretation, capped at 256 attributes and 4096 bytes each.
  Missing/duplicate attributes refuse the snapshot. Raw position tokens, optional
  eligibility/loadout fields and complete bounded SO bytes preserve evidence and
  unknown fields; an omitted protobuf default remains distinguishable from presence.
- The initial cache must match the connected account and provide capacity,
  unique item identities, and valid non-colliding placed slots. Missing data
  fails instead of becoming an empty backpack. IDs cross JSON as strings.
- `core/src/inventory.rs` reads the installed `items_game.txt`, English
  localization, and bounded artwork from `tf2_textures_dir.vpk`. Icons load in
  bounded batches using suitable VTF mip levels. Installed metadata and bounded
  item attributes provide paint, wear, effect, kit, and fabricator labels where
  available; the preview does not reproduce in-game materials, wear, or effects.
- Inventory is account-owned and is outside profile draft boundaries. It never
  enters profile manifests, exports, or profile switching.
- App snapshots remain in memory. Same-account refreshes preserve browsing state
  and cached art; account changes reset them. Helper stdout is bounded and consumed
  privately by the parent; Steam SDK diagnostics are not exposed in the pane.

## Standalone diagnostic

```powershell
cargo test --manifest-path tools/inventory-probe/Cargo.toml --locked
cargo clippy --manifest-path tools/inventory-probe/Cargo.toml --all-targets --locked -- -D warnings
cargo build --manifest-path tools/inventory-probe/Cargo.toml --locked
tools/inventory-probe/target/debug/execs-inventory-probe.exe "H:\SteamLibrary\steamapps\common\Team Fortress 2\bin\x64\steam_api64.dll"
```

Use the absolute path to your installed Valve library. No arguments prints usage.
The standalone diagnostic emits a prefixed JSON result containing SteamID and
item identities; do not publish its raw output. It stores no credentials or files.
Steam must be running and signed in, and TF2 must be closed. Connecting can briefly
show the account as playing TF2 without launching the game. Use the same OS user,
elevation and package context as Steam (see the root AGENTS.md Explorer launch rule).
The transport currently targets x64; native Linux connectivity is not verified.

## Verification recorded on 2026-09-19

Windows live read succeeded through the existing Steam session: 1,111 items,
1,700 slots, 34 pages. The coordinator sent subscription check 27; answering with
refresh 28 yielded the complete cache 24. The native pane displayed real base
artwork and names; search and item inspection were exercised without item writes.
Local metadata verification decoded Scattergun and Refined Metal artwork.
No account identifiers, private item records, or screenshots are committed.

Automated coverage includes ownership, duplicate identities/slots, incomplete
capacity, 64-bit string identities, malformed envelopes, prefab inheritance,
icon path limits, pagination/search, and failed-refresh snapshot clearing.

## Remaining milestones

- Verify Linux, signed-out/disconnect/account-switch behavior and empty backpacks.
- Qualify single moves, swaps, cross-page batches, unplaced items and full backpacks.
- Qualify each metal conversion and one-item deletion with owner-selected disposable
  items; verify persisted state after reconnect and in TF2.
- Exercise interrupted sends, disconnects, account switches and restart reconciliation
  on Windows/Linux packaged candidates. Automated fake sessions do not establish live
  platform qualification.

## References and credits

- [Valve Game Coordinator interface](https://partner.steamgames.com/doc/api/ISteamGameCoordinator)
- [Valve flat Steamworks declarations](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/public/steam/steam_api_flat.h)
- [node-tf2 wire schemas](https://github.com/DoctorMcKay/node-tf2/tree/master/protobufs)
  and [handlers](https://github.com/DoctorMcKay/node-tf2/blob/master/handlers.js),
  used to identify wire field numbers, cache types and position encoding.
- [Valve GC binary header declarations](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/public/gcsdk/gcmsg.h)
  and [node-steam-user GC transport](https://github.com/DoctorMcKay/node-steam-user/blob/master/components/gamecoordinator.js)
  specify the version/job fields and Steam's 18-byte binary transport header.
- [Jengerer's Item Manager](https://www.jengerer.com/item_manager/), by Jengerer
  and contributors, inspires the organizer. It is credited in the pane, README
  and THIRD_PARTY.md. Its unlicensed code/assets are not dependencies.
