# Windows package capability implementation

2026-09-22. Reviewed atop `ee0a8f22db5f6a07af053bd070490d55c9f271e9`. **Root and independent source review are clear; data-only checks pass; hosted Windows capability is pending.** Root independently reran all 21 tests, scoped Biome, Node syntax and PowerShell AST parsing. No installer, driver, application, native helper or registry action was executed locally, and no hosted run was dispatched.

The [new workflow](../../../../../.github/workflows/development-windows-package-smoke.yml) implements only the previous-public Windows capability experiment from the [research note](windows-automation-research.md). It does not build or qualify the current candidate. The code is split into [orchestration](../../../../../scripts/windows-package-smoke.mjs), [data and asset contracts](../../../../../scripts/windows-package-contract.mjs), [native Windows actions](../../../../../scripts/windows-package-native.ps1), [bounded ZIP inspection](../../../../../scripts/windows-package-zip.py), and [behavioral tests](../../../../../scripts/windows-package-contract.test.mjs).

The intended hosted sequence is:

1. Derive the previous public version from guarded repository history, require public latest to agree, and verify the actual NSIS asset's Minisign signature. The current baseline is `v0.1.8`.
2. Install into a fresh private directory on `windows-2022`; run that installed executable with the synthetic profile library. Record executable/version, notices, runtime, driver and package identity.
3. Attach Edge WebDriver to the production WebView2 instance, perform a trusted W3C profile-menu click and Tab navigation, then use the app's Export action and a PID/owner-bound native Save dialog. Validate the exact resulting ZIP independently.
4. Request normal native window close and observe exit zero before driver or process cleanup. Compare original app-data/live bytes and directory inventories, including the retained export hash.

There is no direct application IPC, injected application state or preview fallback. Profile payloads come from the tagged exporter; library identities, index, settings and synthetic install remain authored fixture data. Source guards reject local/self-hosted/SYSTEM contexts, tags, forks, signing secrets, existing product data/installations, Steam registry discovery and existing execs/Steam/TF2 processes. Child app data and WebView2 data are private; debugging endpoints must be loopback-only.

The native helper snapshots the exact app-specific HKLM WebView2 values/types. Restoration reuses the existing apply request, including after an uncertain apply outcome. Process inspection/cleanup takes bounded stdin so a failed evidence write cannot prevent the action. Action receipts survive failed persistence; cleanup waits for tracked Node exit notifications before reinspection. Asynchronous log errors have handlers and are awaited during teardown. Initial/final report failures are aggregated while teardown still runs, and any such failure fails the probe.

Native Save observations retain window/control identifiers before matching, focus and invocation. Accepted WebView screenshots require settled fonts/motion and three identical frames/state. An unsupported native control, inaccessible desktop or failed attachment remains a failed capability stage with evidence; forced cleanup cannot satisfy normal close.

Validation recorded here: **21/21 data-only tests**, independently rerun, including the unchanged retained v0.1.8 export, altered payload/metadata, traversal, duplicate/unknown/symlink/oversized ZIP members, containment, host guards, private debugger identity, evidence failures, delayed exit callbacks and asynchronous log errors. Scoped Biome, Node syntax, Python compile-only, PowerShell AST-only, YAML parsing and six-file LF checks passed. These checks do not establish that hosted NSIS, WebView2 or UI Automation execution works.

Candidate installation/upgrade/import/reopen, signed self-update, the actual updater UI, interactive installer pages, standard-user Windows coverage, screen-reader speech and real Steam/TF2/Cloud behavior remain outside this checkpoint. The next step is the bounded hosted probe; its result must retain that old-only attribution.
