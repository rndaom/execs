# Linux development packages: run 35942107825

This [hosted run](https://github.com/rndaom/execs/actions/runs/35942107825) **passed** on draft PR #60 head `f0caa579a62d6ac8b46af408627d43080323712b` through tested merge `72f6e3ef30c8ab4678085e940deecca194779c3d`. The candidate AppImage and Debian packages were unsigned development builds; authenticated public v0.1.8 was the previous-version baseline. No release, signed updater or public installer was produced.

All three [structured cases](evidence/results.json) passed:

- [AppImage upgrade](evidence/appimage-upgrade/results.json): the public AppImage exported a profile through its native UI; the candidate replaced it, imported and switched to that export, then reopened with the selected bytes intact.
- [Debian upgrade](evidence/deb-upgrade/results.json): the public package installed and exported through its native UI; the candidate upgraded it and passed import, switch, reopen and exact fixture checks.
- [Debian first install](evidence/deb-first-install/results.json): the candidate installed without a previous execs package, launched and reopened with its initial fixture intact.

Both upgrade Import choosers remained open after the first Return. The harness captured each still-open, owned dialog and sent one additional focus-checked Return; both then dismissed and the downstream ZIP, profile and restart proofs passed. The previous-public Export choosers dismissed after one Return. This confirms the narrow harness correction exercised in the run. The earlier [run 35940690993](https://github.com/rndaom/execs/actions/runs/35940690993) stopped at the first Import Return; its artifact could not establish why GTK retained the dialog.

The run passed optimized build and packaged-notices checks. Its 28 retained PNGs include the two still-open dialog captures and legible final Files states; the AppImage retry and final AppImage/Debian first-install captures were inspected. Structured results record package identities, fixture hashes, process cleanup and final comparison. Windows NSIS, signed self-update, Steam Cloud, retail TF2 and other environments remain outside this run.

The original workflow artifact is API artifact `10785711975`, named `development-linux-packages-72f6e3ef30c8ab4678085e940deecca194779c3d`. Its 45 extracted files are archived byte-for-byte beneath `evidence/`; [provenance.json](provenance.json) records their sizes and SHA-256 hashes. The ZIPs are small synthetic profile exports, not installer binaries.
