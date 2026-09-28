# RAR import implementation and checks

RAR4 and RAR5 single-volume archives, including compressed solid archives,
now use the shared archive reader. The existing Mods import review and
transaction apply to their output. ZIP and 7z limits and decoders are unchanged.

## Decoder choice

`unrar-ng-sys` is pinned to 0.7.7. Its bundled decoder is UnRAR 7.21 beta 1,
dated March 22, 2026. The Rust wrapper is MIT OR Apache-2.0; the native decoder
has the separate non-OSI UnRAR restriction against recreating RAR compression.
The owner explicitly approved extraction use during this task. The app never
creates RAR archives. `THIRD_PARTY.md` identifies the distinction, and the
notice generator checks SHA-256 hashes of both `license.txt` and `acknow.txt`
before including their full text (including the Intel BSD notice) in packages.

The older `unrar_sys` 0.5.8 bundled a 2024 decoder and lacked the fork's packed
FFI structure correction. [libarchive's RAR4 reader](https://github.com/libarchive/libarchive/blob/master/libarchive/archive_read_support_format_rar.c)
explicitly refuses solid archives. [compcol](https://docs.rs/compcol/latest/compcol/rar5/index.html)
provides permissively licensed decompression streams, but leaves archive
headers and checksums to its caller. Neither met this change's full format
requirements with a small adapter.

## Boundaries

The adapter checks raw headers and CRCs before opening a native handle. It
bounds header bytes, names, entry count, declared per-file/total output,
compression ratio and the dictionary. It validates paths before native name
normalization and rejects portable case collisions. Native names, sizes,
directory flags and packed lengths must agree with preflight.

UnRAR receives an exact copy in a temporary directory. Only `RAR_TEST` is used:
member paths never reach native filesystem extraction. Its synchronous callback
bounds real output before copying, counts discarded junk in solid streams,
and refuses password, volume and dictionary override requests. Native checksum
errors and size mismatches discard the entire result. A mutex serializes the
decoder's process-global state; handles close before temporary-file cleanup.

The dictionary cap is 128 MiB. This is not a process memory limit: RAR4 PPM
can separately request a nominal 256 MiB model, whose allocation grows with
native pointer/alignment overhead; the decoder can use up to eight threads.
Output buffers remain subject to the caller's existing archive limits.

Encrypted archives, multipart archives, links, alternate streams, file
versions, unsupported service records, legacy encoded Unicode names and
Quick Open caches refuse with extracted-folder guidance. Quick Open is refused
because the native API cannot disable its substituted cached headers. These
are explicit compatibility limits, not silent partial extraction. RAR5 streams
requiring the newer RAR7 compression algorithm also refuse.

## Verification

Windows: eight focused tests pass, including actual upstream RAR4/RAR5 normal
and multi-member solid archives, encrypted names/data, multipart and Quick Open
refusal, all truncated prefixes of the solid fixtures, malformed vints,
tampered compressed data, malicious paths/collisions, dictionary/size/count/
ratio bounds, and callback limits for both retained and discarded output.
`cargo clippy -p execs-core --lib -- -D warnings` passes. The notices generator
verifies 467 dependency packages. Fixtures retain licenses and pinned URLs /
SHA-256 in `core/fixtures/rar/`.

Linux was not run locally: WSL is not installed. The same portable tests must
pass in Linux CI before this change is considered verified on both supported
platforms. No live TF2, profile or Steam files were changed by these tests.
No release or version change is part of this work.
