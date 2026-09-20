# Inventory connection prototype

Private development tool for the future execs Inventory pane. It is outside the
desktop workspace, has no IPC/UI integration, and is not included in installers.
It connects through the already signed-in Steam client. No passwords, browser
cookies, API keys, or refresh tokens are requested or stored.

## Run

Build and test without Steam:

```powershell
cargo test --manifest-path tools/inventory-probe/Cargo.toml --locked
cargo clippy --manifest-path tools/inventory-probe/Cargo.toml --all-targets --locked -- -D warnings
cargo build --manifest-path tools/inventory-probe/Cargo.toml --locked
```

With Steam signed in and TF2 closed, run the executable from a normal terminal:

```powershell
tools/inventory-probe/target/debug/execs-inventory-probe.exe "H:\SteamLibrary\steamapps\common\Team Fortress 2\bin\x64\steam_api64.dll"
```

Supply the actual absolute path to your installed Valve library. Never point it
at a downloaded third-party DLL. Linux uses the native TF2 `libsteam_api.so` and
the executable without `.exe`; native Linux connectivity remains unverified.
The ABI implementation is intended for x64. Do not run under a different user,
elevation level, or Windows MSIX package context than Steam. For development
from packaged Codex, use the existing Explorer desktop's ShellExecute mechanism
as described in the root AGENTS.md.

No arguments prints usage without loading Steam. Connecting may temporarily
show the account as playing TF2, although it never launches the game. The probe
refuses a running TF2 process, stops on account change/disconnection, and exits
after 30 seconds if a complete initial cache does not arrive. Its only outbound
GC message is ClientHello, retried at five-second intervals until welcomed.
It cannot move, sort, craft, delete, equip, trade, or acknowledge new items.

Output contains aggregate counts only. Item IDs and SteamID remain in memory.
The initial snapshot must match the connected account, contain exactly one
item-cache group, and have unique item identities. Missing data is an error,
not an empty backpack. Incoming messages are capped at 8 MiB.

## What this proves, and what it does not

Successful output demonstrates session access, a GC welcome, and an
account-matched initial item cache. It does not prove full metadata support,
backpack capacity, continuous synchronization, safe concurrent app/game
handoff, reliable writes, or redistribution/support of this integration.
Subsequent shared-object updates are not applied by this short-lived probe.
The full product must reconcile those updates before accepting edits.

Some protocol versions may deliver caches inside welcome messages; this first
probe handles standalone SOCacheSubscribed only and times out explicitly if
that is insufficient. Compatibility must be established with live evidence,
not inferred from passing parser fixtures.

## References and provenance

First-party implementation; no JIM code or assets are copied.

- [Valve's Game Coordinator interface](https://partner.steamgames.com/doc/api/ISteamGameCoordinator)
  defines the transport methods and delivery limitations.
- [Valve's flat Steamworks declarations](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/public/steam/steam_api_flat.h)
  define the native function signatures.
- [node-tf2 protocol schemas](https://github.com/DoctorMcKay/node-tf2/tree/master/protobufs)
  document the wire field numbers used by the independently declared minimal
  protobuf messages. [Its handlers](https://github.com/DoctorMcKay/node-tf2/blob/master/handlers.js)
  document item-cache type 1 and backpack-position encoding.
- [Jengerer's Item Manager](https://www.jengerer.com/item_manager/) by Jengerer
  and contributors inspired the future organizer interactions. Its public
  repository has no identified reuse license; it is not a dependency.

## Next implementation gates

1. Verify live read-only access on Windows and Linux, including missing Steam,
   signed-out state, reconnect, account changes and large/empty inventories.
2. Add complete item/account metadata and live shared-object reconciliation.
3. Integrate a separate account-owned Inventory pane with credits and fixtures;
   inventory never belongs to or switches with a customization profile.
4. Build a deterministic local layout planner, selection and keyboard controls.
5. Prove acknowledged position changes and recovery in a controlled test before
   enabling Apply arrangement. Crafting and deletion follow separately.

Release is a future minor milestone, not a commitment to 0.2.0. This prototype
does not add a shipped feature, so no user-facing changelog claim is made yet.
