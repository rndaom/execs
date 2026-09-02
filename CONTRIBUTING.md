# Contributing

Bug reports and pull requests are welcome. Open an issue first for anything
larger than a fix, so the approach can be agreed before the work.

## Setup

You need Node 24, pnpm 9 and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)
(Rust stable; WebView2 on Windows, webkit2gtk 4.1 on Linux).

```
pnpm install
pnpm desktop:dev
```

`pnpm dev` runs the frontend alone in a browser with fixture data; append
`?preview=settings-comfig` (or any state listed in `apps/desktop/src/lib/preview.ts`)
to the URL to jump to a screen. The Vite port defaults to 1420; set
`EXECS_DEV_PORT` and pass the matching `devUrl` to Tauri if it is taken.

## Checks

CI runs these on every pull request.

```
pnpm test
pnpm check
cargo fmt --all --manifest-path apps/desktop/src-tauri/Cargo.toml --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --locked
```

## Ground rules

`AGENTS.md` is the product spec. The rules under "Integrity line" are not
negotiable: the app writes only `tf/custom/`, `tf/cfg/overrides/` (or the
vanilla user cfg files) and the Steam Cloud copy of `config.cfg`, never while
the game is running, with the single documented exception for the Mods pane.

Anything that installs third-party content must credit the source in the UI
and in `THIRD_PARTY.md`, and must fetch it pinned to a release or commit rather
than vendoring it.

## Releases

Bump `version` in `apps/desktop/src-tauri/tauri.conf.json`, `Cargo.toml` and
`package.json`, then push a `vX.Y.Z` tag. The release workflow builds the
Windows installer and the Linux AppImage and .deb, verifies the updater
manifest covers both platforms, and publishes the release.
