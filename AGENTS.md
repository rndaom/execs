# execs — agent notes

Working agreement: durable product/design decisions get recorded here as they are made.

## Product decisions
- Name "execs" (execs.tf) is a working name — renameable before launch. It appears in: repo name, branding, R2 bucket names, and the managed install folder `tf/custom/execs-custom/`.
- V1 = core loop only (Steam sign-in, upload, browse/search, detail, download, direct install). Social features are Phase 2.
- Video on config pages = YouTube embeds only, never hosted video.
- Uploads: `.cfg/.txt/.md` only (no VPK in v1); block-tier lint findings reject the upload entirely.
- Install layout: known override files → `tf/cfg/overrides/`; everything else → `tf/custom/execs-custom/cfg/`. Never `tf/cfg/user` (deprecated by mastercomfig).

## Design decisions
- posts.tf dark minimalism × TF2 identity: bg `#121212`, ink = TF2 tan `#EBE2CA`, accent = item orange `#CF6A32`, pill buttons, item-quality colors for badges only.
- Display font: Big Shoulders Display (free, OFL) behind the `--font-display` token — a TF2-Build lookalike. Swap only if TF2 Build web licensing is ever verified.
- Sitewide footer: "Powered by Steam" + not-affiliated disclaimer (Steam API ToS requirement).

## Deployment
- Live at https://execs.anthonyrandomcarey.workers.dev (Cloudflare Worker "execs", account cd3030bf...). Deploy: `pnpm deploy` from repo root (wrangler OAuth already on this machine).
- Production D1 `execs` (id e6ccd1d9-e0a7-48f1-a8b3-372c62b6be18), R2 buckets `execs-files` + `execs-media`. Migrations: `pnpm --filter @execs/web db:migrate:prod`.
- Secrets set: SESSION_SECRET. NOT yet set: STEAM_API_KEY (sign-in works, personas are placeholders until set), ADMIN_STEAM_IDS (needed for /mod access).
- `.npmrc` uses `node-linker=hoisted` — required on Windows (Next standalone build replicates pnpm symlinks, which Windows blocks without Developer Mode). Don't remove it.

## Launch to-dos (user)
1. Steam Web API key → `wrangler secret put STEAM_API_KEY` (+ .dev.vars locally).
2. `wrangler secret put ADMIN_STEAM_IDS` with your steamid64 to unlock /mod.
3. Run the preview capture session in TF2 (tools/capture/CHECKLIST.md), process + upload, flip `capturesAvailable: true` in packages/preview-matrix/src/matrix.json, redeploy.
4. Test direct install against the real TF2 folder in Chrome/Edge on the live site.
5. Custom domain (execs.tf or otherwise) → update APP_URL in wrangler.jsonc + redeploy.

## Conventions
- Plain `package.json` scripts only (Windows dev machine) — no bash-isms.
- LF line endings enforced via .gitattributes; cfg fixtures must never be CRLF.
- `design-qa.md` is a dated QA log; add an entry per visual QA pass.
