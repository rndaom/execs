# Windows previous-public capability: run 35944325809

This [hosted run](https://github.com/rndaom/execs/actions/runs/35944325809) **failed** on draft PR #60 head `0e5a24f24a6dc4268fbbdea9fc2ec935f1b6ecc9` through tested merge `35bbefababe423daa997a6f8bf507b9c4cfd3d0b`. It used the authenticated public v0.1.8 NSIS installer in a disposable development fixture; it was not a candidate installer or signed updater test.

The previous process-identity fix worked: later [inspection](evidence/05-inspect-receipt.json) retained the same app and WebView2 identities and observed the private DevTools listener on `127.0.0.1:60173`. The browser version endpoint was read. This establishes that the older runs' first empty listener snapshot did not prove a lasting listener failure.

The run stopped before UI export when [EdgeDriver inspection](evidence/07-inspect-receipt.json) found its listener bound to IPv6 wildcard `::` on its selected port. The harness correctly refused a non-loopback listener even though [EdgeDriver's log](evidence/edge-driver.log) reported an IP allowlist of `127.0.0.1`. The retained receipts also show a `UIAutomationTypes, Version=10.0.0.0` load failure, so native UI access remains unproved. App/WebView2 cleanup succeeded, but cleanup of a separate `conhost.exe` child refused an executable outside the then-allowed process tree; the main step later hit its 12-minute timeout. The structured [result](evidence/result.json) keeps the primary failure, cleanup failure, policy restoration, and final synthetic fixture comparison distinct.

The next harness change must preserve the loopback and process-identity guards while addressing EdgeDriver binding, driver-child cleanup, and the UI Automation dependency. No Windows export, candidate upgrade, import, reopen, or package qualification is claimed from this run.

The original workflow artifact is API artifact `10786258373`, named `windows-previous-public-capability-35bbefababe423daa997a6f8bf507b9c4cfd3d0b`. All 51 extracted files are archived byte-for-byte beneath `evidence/`; [provenance.json](provenance.json) records sizes and SHA-256 hashes. The fixture contains synthetic profile data, not installer binaries.
