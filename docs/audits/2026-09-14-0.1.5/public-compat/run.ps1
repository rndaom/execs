param([string]$RunName = ('run-' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()))

$ErrorActionPreference = 'Stop'
if ($RunName -notmatch '^[A-Za-z0-9-]+$') {
    throw 'Use a simple fresh run name containing letters, numbers, and hyphens.'
}

$compatManifest = Join-Path $PSScriptRoot 'Cargo.toml'
$compatTarget = Join-Path $PSScriptRoot 'target'
& cargo run --offline --locked --manifest-path $compatManifest --target-dir $compatTarget -- $RunName
if ($LASTEXITCODE -ne 0) {
    throw "Compatibility probe failed with exit code $LASTEXITCODE."
}
