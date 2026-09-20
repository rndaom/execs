# Files workspace layout decision (0.1.7)

Files is a code workspace within the existing app shell. It uses the existing color,
type and action tokens. A fixed-width system code font and one bounded editor
scroll surface are explicit Files-only exceptions to Inter-only and no inner scroll
boxes. No hero artwork is useful for source authoring. Other panes are unchanged.

The workspace has one full-width editor, with compact actions above it. Explorer,
Problems and Reference are disclosures below the editor, never competing permanent
columns. The selected filename is prominent; its full path remains selectable.
Focus mode closes all auxiliaries. Save stays in the editor header. At 960×640 the
editor targets twelve 20px lines before its status bar; at 1200×800 and 1280×800 it
uses the same width rule and targets eighty typical cfg columns in focus mode.
There is no 1280px three-column breakpoint. At 200% zoom actions wrap and the page
scrolls vertically; source text uses its own horizontal scroll with optional wrap.

Explorer shows filename first and the parent path second, groups User, Managed and
Provided, and searches loaded source plus retained drafts. Results disclose bounded
coverage. Problems defaults to the selected document and source actions preserve all
drafts. Reference and new-cfg previews remain user-invoked. Ordinary file navigation
has no save/discard dialog; application transitions retain their existing guard.

Verification measurements and native-platform limits belong in the release
qualification record. These targets are not evidence of native rendering.

Files contrast check (sRGB WCAG relative luminance, September 20): essential
muted text/comments/line numbers #a49c8e against panel #181818 is 6.53:1 and
against raised #1f1f1f is 6.06:1. String #729e42 is 5.65:1 and 5.25:1 respectively.
Numbers now use muted ink; the existing team-blue token was 4.47:1 on panel and
is not used for syntax. Faint ink (3.26:1) is not used for essential editor text.
Focused editor outline uses muted ink rather than a low-alpha hairline. These
computed checks do not substitute for native forced-colors/screen-reader testing.
