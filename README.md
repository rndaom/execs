# execs

Community hub for Team Fortress 2 configs: browse, share, preview, and one-click-install.

- `apps/web` — Next.js 15 app on Cloudflare Workers (OpenNext), D1 + Drizzle, R2 storage
- `packages/cfglint` — standalone Source-cfg parser/linter (the safety core)
- `packages/preview-matrix` — preview capture matrix data (modules, levels, cvar mappings)
- `tools/capture` — in-game capture session scripts for the preview matrix

## Dev

```
pnpm install
pnpm dev        # next dev with local Miniflare D1/R2 bindings
pnpm preview    # real workerd runtime via OpenNext
pnpm test
```

Secrets for local dev go in `apps/web/.dev.vars` (`STEAM_API_KEY`, `SESSION_SECRET`).

execs is a fan project and is not affiliated with Valve Corporation.
