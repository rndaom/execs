# D8 Rust curl-binding probe

This standalone crate tested whether the Rust `curl` binding preserves the original HTTPS hostname while directing a proxy `CONNECT` to a numeric address. It remains **audit evidence only** and is not a product or release dependency. At the time of this probe, the app used reqwest; the later draft product migration is recorded in the [D8 design](../d8-proxy-binding-design.md). The pinned `Cargo.lock` uses `curl` 0.4.50 and `curl-sys` 0.4.90 with bundled libcurl 8.21.0 on the tested Windows build.

From the repository root in PowerShell, with Rust, Python 3 and the Python `cryptography` package available:

```powershell
$target = Join-Path $env:TEMP 'execs-d8-rust-curl-target'
cargo build --locked --manifest-path docs/audits/2026-09-23-program-audit/d8-rust-curl-prototype/Cargo.toml --target-dir $target
python docs/audits/2026-09-23-program-audit/d8-curl-probe.py --rust-client (Join-Path $target 'debug/d8-curl-prototype.exe')
```

The [loopback fixture](../d8-curl-probe.py) creates an ephemeral CA and a local fake HTTP proxy. The proxy records the `CONNECT` request, acknowledges it, and serves TLS on that same socket; it never dials the numeric target. The Rust binary uses that proxy, `connect_to`, normal origin peer/name verification, a five-second total timeout, and a fixed `https://example.com/` URL. Its Schannel-only `no_revoke` setting is confined to this fixture because the ephemeral CA has no CRL endpoint; it is not a proposed product setting.

**Windows result, September 24, 2026:** `cargo build --locked` passed. The Python fixture passed numeric IPv4 and bracketed IPv6 `CONNECT`, Basic proxy auth, original `example.com` SNI and HTTP `Host`, a matching origin certificate, and rejection of a wrong-name certificate before an HTTP request. Windows `curl.exe` passed the same cases independently. The fixture's output is summarized in [the D8 design](../d8-proxy-binding-design.md).

This does not exercise environment proxy selection, `NO_PROXY`, an HTTPS proxy, redirects, response-size enforcement, Linux builds, or packaged NSIS/AppImage/`.deb` behavior. The product transport must satisfy those cases before D8 can be checked.
