# Linux development packages: run 35937290557

This [hosted run](https://github.com/rndaom/execs/actions/runs/35937290557) passed on draft PR #60 head `65d20bd905435a6d4813b39c13537339d94b7b2b` through the tested PR merge `4c363147a62a624a7bda7f2ecae13541d505d37f`. The candidate AppImage and Debian packages were **unsigned development builds**. Public v0.1.8 was the authenticated previous-version baseline; no release, signed updater, or public installer was produced.

All three [structured cases](evidence/results.json) passed:

- [AppImage upgrade](evidence/appimage-upgrade/results.json): the previous public AppImage launched through a read-only FUSE mount, exported a profile through the native UI, and closed. The candidate replaced it, opened the preserved setup, imported and switched to the exported profile, then reopened with the selected bytes intact.
- [Debian upgrade](evidence/deb-upgrade/results.json): the previous public package installed and exported through the native UI; the candidate package upgraded it and passed the same import, switch, reopen, and exact fixture checks. The inspected package ELF matched the installed and running executable.
- [Debian first install](evidence/deb-first-install/results.json): the candidate installed without a previous execs package, launched, and reopened with its initial fixture intact.

The run passed the optimized build and packaged-notices checks. Its 26 retained screenshots include real native GUI states; the three final Files captures were inspected as legible and nonblank. The structured results carry package identities, fixture hashes and process/cleanup checks. Windows NSIS, signed self-update, retail TF2, Steam Cloud, media decoding and other Linux environments remain outside this run. The previous [run 35780702038](../run-35780702038/README.md) stopped before Debian installation because of an invalid harness assertion; this run supersedes that limit for its tested Debian paths.

The original workflow artifact is API artifact `10783592416`, named `development-linux-packages-4c363147a62a624a7bda7f2ecae13541d505d37f`. Its 43 extracted files are archived byte-for-byte beneath this directory. [provenance.json](provenance.json) records their sizes and SHA-256 hashes; the ZIPs are small synthetic profile exports, not installer binaries.
