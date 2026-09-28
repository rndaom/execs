# unrar-ng-sys 0.7.7 with UnRAR 7.23

This folder is a local copy of the crates.io package `unrar-ng-sys` 0.7.7
([ttys3/unrar.rs](https://github.com/ttys3/unrar.rs), MIT OR Apache-2.0). The
workspace uses it through `[patch.crates-io]` in `../../Cargo.toml` and keeps it
out of the workspace members, so it is built exactly like the registry copy.

Every published `unrar-ng-sys` release bundles a beta UnRAR (0.7.7 has
UnRAR 7.21 beta 1). execs decodes untrusted downloads with it, so this copy
replaces only `vendor/unrar/` with RARLAB's stable UnRAR 7.23 source and carries
the crate's own small changes over to it.

## Sources

| Part | Source | SHA-256 |
| --- | --- | --- |
| Crate files (`Cargo.toml`, `build.rs`, `src/`, `examples/`) | `https://crates.io/api/v1/crates/unrar-ng-sys/0.7.7/download` (unchanged) | `72678d22d4d6aa9f0b905f5d6d5cd3e462c55631b526297d06fb1663532daa76`, the checksum the lock file held |
| `vendor/unrar/` | `https://www.rarlab.com/rar/unrarsrc-7.2.7.tar.gz` (UnRAR 7.23, June 27, 2026, `RARVER_BETA 0`) | `01d903a7dcf413cb2925696d7796e48e38d471f79bfe7ef3ad2aebf6c12dbefd` |

`execs-crate-changes.patch` is the difference between RARLAB's UnRAR 7.21 beta 1
source (`unrarsrc-7.2.5.tar.gz`) and the crate's bundled copy: the crate's batch
extraction entry points and events in `dll.cpp`/`dll.hpp`/`dll.def`, and small
portability fixes in `rijndael.cpp`, `system.cpp` and `unicode.cpp`. It applies
to 7.23 with offsets only; `dll.def` differs from 7.21 beta 1 only in line
endings, so the crate's copy is used as is. execs never calls the batch
extraction entry points; it only tests archives (see `core/src/archive_rar.rs`).

`license.txt` and `acknow.txt` are byte-identical to the crate's bundled copies,
and `scripts/third-party-notices.mjs` still verifies both hashes. `.gitattributes`
keeps these files byte-exact.

## Updating

1. Download a stable `unrarsrc-*.tar.gz` from RARLAB and check `RARVER_BETA 0`
   in `unrar/version.hpp`.
2. Replace `vendor/unrar/` with it and apply `execs-crate-changes.patch` inside
   that folder (`patch -p1`), resolving any rejected hunk by hand.
3. Rebuild, run the RAR tests (`cargo test -p execs-core --lib archive`) and
   `node scripts/third-party-notices.mjs --check`, then update this file, the
   notice title in that script, `THIRD_PARTY.md` and the RAR audit notes.

When a published `unrar-ng-sys` release bundles a stable UnRAR, remove this
folder and the `[patch.crates-io]` entry instead.
