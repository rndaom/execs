# 0.1.6 verification

This directory records preparation, not publication. The issue scope and release
gates are maintained in [the release record](../../release-0.1.6.md).

## Research and implementation decisions

- [Valve's KeyValues implementation](https://github.com/ValveSoftware/source-sdk-2013/blob/master/src/tier1/KeyValues.cpp)
  grounds escape-disabled resource strings, ordered includes and conditional
  identities. HUD edits preserve existing source spans and reparse the result;
  Steam VDF behavior is unchanged.
- [TF2HUD.Editor file edits](https://criticalflaw.ca/TF2HUD.Editor/json/files/)
  and [control contracts](https://criticalflaw.ca/TF2HUD.Editor/json/controls/)
  ground folder variants, conditional includes and value templates. Expressions
  use a bounded interpreter, not JavaScript or shell execution.
- [Pinned editor schemas](https://github.com/CriticalFlaw/TF2HUD.Editor/tree/17bccd15d818d12707ce89574318acbc23c85a9f/src/HUDEditor/JSON)
  are compared with the actual pinned HUD packages. A reported successful write
  is insufficient: checks inspect active include targets, declared font names,
  independent control targets and exact payload hashes.
- [Valve's HUD compatibility announcement](https://www.teamfortress.com/post.php?id=22759)
  requires real compatibility metadata; the patch never manufactures it.
- [Windows long-path rules](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation)
  explain extended native move endpoints. Containment checks and payload names
  remain intact.
- Valve's shipped `cfg/user_default.scr` was read from the local stock VPK to
  verify the Advanced Options definition format. It remains opaque profile data;
  see [creator import evidence](../../creator-import-0.1.6.md).

## Reproducible gates

- On the 0.1.6 maintenance branch, `node scripts/verify-public-profile.mjs`
  ([source](https://github.com/rndaom/execs/blob/codex/release-0.1.6/scripts/verify-public-profile.mjs)) compiles actual public 0.1.5 and
  candidate cores. The public exporter creates the ZIP, and candidate imports,
  re-exports and re-imports compare bytes, hashes, metadata and active-profile
  preservation. Both maintenance GitHub platform jobs run it. This comparison
  is specific to the maintenance schema and is not installed as a main gate.
- `node scripts/verify-pinned-huds.mjs` downloads exact upstream revisions and
  verifies SHA-256 before tests. It exercises actual rayshud options,
  HypnotizeHUD includes, budhud directories, kbnhud/HypnotizeHUD declared fonts,
  and HypnotizeHUD/kinhud/m0re Rockz installation and update integrity.
- [Sound checks](sounds.md) cover profile/content invalidation, delayed reads,
  source identities, accessible labels and preservation of newer sound drafts.
- [HUD import checks](../../hud-import-0.1.6.md) cover shared junk filtering and
  ZIP/7z/folder parity. [Schema compatibility](../../hud-schema-compatibility.md)
  explains unsupported controls and retained saved values.

Automated filesystem probes use disposable fixtures. A separate attempted
[retail smoke failed Cloud isolation and required verified recovery](retail-hud-smoke.md);
it is not a passing gameplay gate. The exact successful candidate CI run,
signed package results and remaining acceptance gates are recorded in the
release record. [HUD browser checks](hud-ui.md) add keyboard and unavailable
control guidance evidence without claiming native speech or screenshots.
Passing core checks do not establish every HUD's in-game appearance or actual
screen-reader speech.

## Windows build environment

The installed stable Rust executable was blocked by Smart App Control. Official
Rust 1.96.0 was installed alongside it through rustup, without changing security
settings or the default toolchain. This supports the project's Rust 1.93 minimum.
Some earlier independently generated build helpers were also blocked. The final
full local Windows suite and workspace Clippy pass using the side-by-side
toolchain; Windows and Linux GitHub runs are recorded separately. GitHub uses current
stable Rust. No Windows security policy was disabled or bypassed.
