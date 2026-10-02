# Linux development package baseline: public v0.2.2

The Linux development package job uses the platform-independent synthetic profile
exports in [windows-package-v022](windows-package-v022/README.md). Those ZIPs were
emitted by the unmodified tagged v0.2.2 core; the directory name follows the
Windows fixture it shares, not a platform restriction. Their payloads are cfg,
Source VPK and HUD files, without platform-specific paths in the portable
manifests. The Linux fixture still authors its own isolated HOME/XDG/TMPDIR,
library identity, settings and synthetic TF2 root. Release upgrade checks keep
their own previous-public fixture (`package-smoke-v021.json`).

[development-package-v022.json](development-package-v022.json) pins the public
AppImage and Debian package metadata. Both artifacts and their signatures were
downloaded from GitHub v0.2.2 using `gh release download`; each size and SHA-256
matched the release asset metadata. `verifyPublicPackage` verified both updater
signatures against the configured product public key. The exact artifact and
signature hashes are checked again by the hosted job before any package runs.
No downloaded executable is committed or launched during this local check.

The tagged commit is `95058a75f8183fb39eaa6efd33d8b44c47c03c1d`; the published
release-commit.json names the same commit and workflow run `36946290396`. Its
source/export generation evidence is retained with the shared fixture. The job
refuses drift in the latest tag, publication timestamp or pinned assets; a new
public release requires an authentic fixture refresh. The v0.2.1 pins this file
replaces are in Git history (`development-package-v021.json`).

A development candidate whose version is still 0.2.2 exercises a **same-version
replacement**, not an upgrade or release. AppImage replaces the complete file;
Debian uses `apt-get install --reinstall` so equal version strings cannot silently
keep the public executable. Exact candidate binary hashes remain required. A
newer candidate is labeled an upgrade; an older one is refused. Product versions
and release-history validation are unchanged.

Local validation covers fixture/archive integrity, preservation and refusal
boundaries, same-version classification, package metadata pins, and both actual
Linux download signatures. The full hosted package/native UI run remains the
integration proof for installation, export review, import, switch and reopen.
