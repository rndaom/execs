# execs

Windows + Linux desktop companion for Team Fortress 2. Players customize configs and switch named setups while the game is closed. Working name — renameable before launch.

- `apps/desktop` — Tauri 2 + React/TS (the product)
- `packages/cfglint` — Source-cfg parser/linter
- `apps/web` — parked Cloudflare community hub (not the product)

## Dev

```
pnpm install
pnpm desktop:dev
pnpm test
```

`desktop:dev` needs the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) (Rust plus WebView2 on Windows, webkit2gtk on Linux). Frontend-only: `pnpm --filter @execs/desktop dev`.

execs is a fan project and is not affiliated with Valve Corporation.
