# Updater retry fixture

This first-party text payload is signed with a disposable test key generated
using the Tauri signer. Only the public key and signature are retained. It is
not an executable and is never passed to an installer. The integration test
first stalls an incomplete response, then serves the signed bytes on retry,
then changes a byte to verify signature rejection. Production signing keys,
endpoints and updater configuration remain separate.
