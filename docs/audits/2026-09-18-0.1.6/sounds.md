# 0.1.6 Sounds verification

Scope: RND-245, RND-287 and RND-293, based on public `v0.1.5`.

## Findings and implementation

The audition URL map formerly keyed an installed sound by slot alone. Installed
slots now read bytes on every play and own a transient URL. Switching profile or
receiving a changed installed record stops playback and revokes the old URL.
Generation checks reject delayed reads before allocating a URL. Immutable source
auditions retain the existing session cache. Reading each installed audition also
handles replacement with identical metadata, without changing profile formats.

The Rust `HitsoundEntry` already serializes optional `hash` and `token`. The UI
now exposes those existing fields and compares comfig hashes and file tokens;
legacy missing identities never equate a catalog row by name. Community IDs
retain their existing name-based identity. Draft serialization includes source
identity, while ownership stays keyed to the profile and sound slots.

Play/Stop and assignment buttons identify the clip and source. Repeated names
within one source have an ordinal based on the full library, so filtering and
sorting do not rename them. Volume controls identify their hit/kill slot; the
short visual labels and native button order remain unchanged.

## Research

- [W3C File API](https://w3c.github.io/FileAPI/#dfn-revokeObjectURL): object URLs
  need explicit revocation to release their backing references before document
  unload. The changed hook owns and revokes mutable installed URLs.
- [WAI button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/): buttons
  need accessible names and support native keyboard activation. Existing native
  buttons retain their DOM order and receive contextual names.
- Native source inspection: `core/src/hitsound.rs` already retains source hash
  and token separately from display name and boost. No new disk or cfg writes
  are introduced by these fixes.

## Automated evidence and limits

Focused Windows Vitest suite: `SoundsPane.test.tsx`, `useSoundPlayer.test.tsx`,
`retained-pane-interaction.test.ts`, `hitsound-ui.test.ts`,
`sound-library.test.ts` and `MutationDrafts.test.tsx`: 36 tests pass.
TypeScript compilation passes. Tests use real React lifecycles, controlled IPC
and an audio boundary double; they do not substitute for listening in TF2.

Coverage includes A/B profile switching, replacement/boost/removal/reinstall,
unchanged-record byte refresh, late responses and unmount, duplicate comfig
names, picked-file identity, contextual names and native button focusability.
The existing newer sound-edit preservation regressions continue to pass.

WebView2/NVDA and Linux WebKit/Orca spoken-output checks remain a manual release
verification item. jsdom confirms DOM names, order and focusability only.
