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

## Conventions
- Plain `package.json` scripts only (Windows dev machine) — no bash-isms.
- LF line endings enforced via .gitattributes; cfg fixtures must never be CRLF.
- `design-qa.md` is a dated QA log; add an entry per visual QA pass.
