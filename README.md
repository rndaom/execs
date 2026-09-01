# execs

Windows + Linux desktop companion for Team Fortress 2. Players customize configs and switch named setups while the game is closed. Working name — renameable before launch.

- `apps/desktop` — Tauri 2 + React/TS (the product)
- `packages/cfglint` — Source-cfg parser/linter

The parked Cloudflare community hub (`apps/web`, `packages/preview-matrix`, `tools/capture`) is no longer on `main`; its full source is preserved on the `hub` branch.

## Dev

```
pnpm install
pnpm desktop:dev
pnpm test
```

`desktop:dev` needs the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) (Rust plus WebView2 on Windows, webkit2gtk on Linux). Frontend-only: `pnpm dev`.

### Dev server port

The Vite dev server listens on `1420` by default with `strictPort`. Set `EXECS_DEV_PORT` to move it. Tauri's `devUrl` in `apps/desktop/src-tauri/tauri.conf.json` is a static string and cannot read the environment, so if you change the port you must also point Tauri at it — either edit `devUrl` or pass an override, e.g.

```
EXECS_DEV_PORT=1425 pnpm desktop:dev --config '{"build":{"devUrl":"http://localhost:1425"}}'
```

### Rust checks

```
cargo fmt --all --manifest-path apps/desktop/src-tauri/Cargo.toml --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --workspace --locked
```

execs is a fan project and is not affiliated with Valve Corporation.
