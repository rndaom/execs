# RAR regression fixtures

These small upstream archives test real compression streams rather than a
synthetic decoder. `sources.json` pins the source URL/revision and SHA-256 of
each decoded `.rar` file. The libarchive inputs were decoded from uuencoding
with Python's `binascii.a2b_uu`; the other inputs are unchanged binary copies.
Upstream producer versions/commands are not recorded for every archive, so
reproduce these fixtures by retrieving the pinned bytes, not by recompressing.

- `rar4-normal.rar`: unrar 0.5.8 crate, `data/version.rar`; MIT license retained.
- `rar4-solid.rar`, `rar5-quickopen.rar`: Marko Kreen's rarfile tests; ISC license retained.
- Other files: libarchive tests; its license is retained. These test assets are
  development-only and are not packaged as product content.

RAR 3.x compression streams use the RAR4 archive signature; `rar4-solid.rar`
contains two members sharing a dictionary. RAR5 solid contains four members.
Encrypted headers, encrypted data, multipart input and Quick Open are refusal
fixtures, never password or extra-volume prompts.

The native adapter uses `RAR_TEST` and a bounded output callback. It refuses
Quick Open, service records, legacy encoded Unicode names, links, file
versions and alternate streams before native decoding. ZIP/7z behavior is
unchanged. Decoder dictionaries are capped at 128 MiB; RAR4 PPM's internal
one-byte allocator setting separately permits a nominal 256 MiB model (native
pointer/alignment overhead makes its actual allocation larger). Native decode
uses at most eight worker threads. No archive member is extracted to disk.
