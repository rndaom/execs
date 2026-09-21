# Inventory development

The development app has a read-only **Inventory** pane. Load backpack connects
through the existing signed-in Steam client, reads an account-bound snapshot,
and disconnects. The pane supports 50-slot pages, page jumps, search, quality
filters, and item details. It requires Refresh backpack after trades, account
changes, or playing TF2. It does not continuously synchronize.

The sidebar entry is excluded from production frontend builds. Release native
commands and the helper entry point also refuse inventory access. No minor
release has been assigned yet.

## Architecture

- `src/native.rs` and `src/protocol.rs` implement the Steam session and minimal
  protobuf fields. No JIM code or assets are copied.
- The debug desktop executable invokes itself with `--inventory-read` before
  Tauri initialization. The child owns Steam environment variables, callbacks,
  and SDK shutdown. The parent serializes connection attempts with the native
  write gate and terminates a hung helper after 40 seconds.
- Only ClientHello and account-bound SOCacheSubscriptionRefresh are sent.
  No move, sort, equip, craft, delete, trade, or item-acknowledgment requests exist.
- The signed-in persona name and avatar are read through Steam Friends and Utils
  in the same bounded helper session. Missing presentation data remains optional;
  avatars cross IPC as bounded PNG data URLs, with no web-profile request.
- Item attributes retain their exact value bytes (or legacy little-endian uint32)
  for local schema interpretation, capped at 256 attributes and 4096 bytes each.
- The initial cache must match the connected account and provide capacity,
  unique item identities, and valid non-colliding placed slots. Missing data
  fails instead of becoming an empty backpack. IDs cross JSON as strings.
- `core/src/inventory.rs` reads the installed `items_game.txt`, English
  localization, and bounded base artwork from `tf2_textures_dir.vpk`. Icons
  load by visible page. Paint, wear, unusual effects, and full item attributes
  are not previewed; unknown definitions keep their numeric identity.
- Inventory is account-owned and is outside profile draft boundaries. It never
  enters profile manifests, exports, or profile switching.
- App snapshots remain in memory. Helper stdout is capped at 8 MiB and consumed
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
- Add full attributes and continuous shared-object reconciliation before edits.
- Add selection/keyboard layout planning, preview and local undo.
- Prove acknowledged position writes and partial-operation recovery before Apply
  arrangement. Crafting and deletion follow independently.

## References and credits

- [Valve Game Coordinator interface](https://partner.steamgames.com/doc/api/ISteamGameCoordinator)
- [Valve flat Steamworks declarations](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/public/steam/steam_api_flat.h)
- [node-tf2 wire schemas](https://github.com/DoctorMcKay/node-tf2/tree/master/protobufs)
  and [handlers](https://github.com/DoctorMcKay/node-tf2/blob/master/handlers.js),
  used to identify wire field numbers, cache types and position encoding.
- [Jengerer's Item Manager](https://www.jengerer.com/item_manager/), by Jengerer
  and contributors, inspires the organizer. It is credited in the pane, README
  and THIRD_PARTY.md. Its unlicensed code/assets are not dependencies.
