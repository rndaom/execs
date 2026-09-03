# Contributing

execs is a single-maintainer project. **Players install published
[releases](https://github.com/rndaom/execs/releases/latest).** Development
(`main`, drafts, local builds) is not a supported install path.

[Bug reports](https://github.com/rndaom/execs/issues/new?template=bug.yml)
and [discussions](https://github.com/rndaom/execs/discussions) are welcome.
A request is considered for a future monthly release; it is not a promise.
Security reports go to [SECURITY.md](SECURITY.md), not a public issue.

Please open an issue before sending a pull request. Unsolicited changes
to the write surface, the updater, or the profile format are declined.

How releases are cut, versioned, and scheduled: [docs/RELEASE.md](docs/RELEASE.md).

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

`AGENTS.md` is the product spec. The rules under "Integrity rules" are not
negotiable: the app writes only `tf/custom/`, `tf/cfg/overrides/` (or the
vanilla user cfg files) and the Steam Cloud copy of `config.cfg`, never while
the game is running, with the single documented exception for the Mods pane.

Anything that installs third-party content must credit the source in the UI
and in `THIRD_PARTY.md`, and must fetch it pinned to a release or commit rather
than vendoring it.

User-facing changes add a line under `CHANGELOG.md` `[Unreleased]` in the
same commit.

## Releases

The playbook is `docs/RELEASE.md`. In short: write the changelog section,
bump `version` in `apps/desktop/package.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml` and `src-tauri/core/Cargo.toml`, then push a
`vX.Y.Z` tag. The workflow builds both platforms, fills the release body
from the changelog, verifies the updater manifest, and publishes.
