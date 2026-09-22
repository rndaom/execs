# Validator self-test only. Emulates fixture bytes; never launches an application.
[CmdletBinding()]
param([string]$Executable = 'G:\Projects\execs\apps\desktop\src-tauri\target\release\execs.exe')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'InactiveImportFixture.ps1')
$casePath = Join-Path 'G:\Projects\execs\.artifacts\native-isolation' ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-inactiveimport-validator-selftest-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
& (Join-Path $PSScriptRoot 'Start-IsolatedExecs.ps1') -Scenario InactiveImport -Executable $Executable -CaseDirectory $casePath -PrepareOnly | Out-Null
$results = [Collections.Generic.List[object]]::new()
function Assert-Refusal([string]$Name, [scriptblock]$Action) {
    $refused = $false
    try { & $Action | Out-Null } catch { $refused = $true }
    if (-not $refused) { throw "Validator accepted the negative case: $Name" }
    $results.Add(@{ name=$Name; passed=$true })
}
$null = Get-InactiveImportAudit $casePath 'Initial'
$results.Add(@{ name='fresh initial fixture accepted'; passed=$true })
Assert-Refusal 'unimported fixture cannot reopen' { Assert-InactiveImportReopen $casePath }

# This is an authored positive validator sample, not a native import result.
$archivePath = Join-Path $fixtureExports 'multi-hud-change-owner/reexported-by-current.zip'
$archive = Read-InactiveImportArchive $archivePath
$id = [Guid]::NewGuid().ToString()
$profile = Join-Path $casePath "roaming/execs/profiles/$id"
$zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    foreach ($file in $archive.manifest.files) {
        if ($file.storage -eq 'exclusive') { Write-FixtureBytes $profile ('files/' + $file.path) (Read-FixtureZipBytes $zip ('files/' + $file.path)) }
    }
} finally { $zip.Dispose() }
$manifest = $archive.manifest
$manifest.id = $id
$manifest.tf2Root = Join-Path $casePath 'tf2-root'
$manifest.launchSyncPending = $true
$manifest.hudRoots = @('fixturehud','secondhud')
$manifestPath = Join-Path $profile 'manifest.json'
Write-FixtureJson $manifestPath $manifest
$indexPath = Join-Path $casePath 'roaming/execs/profiles/index.json'
$index = Get-Content -LiteralPath $indexPath -Raw | ConvertFrom-Json -AsHashtable
$now = [DateTime]::UtcNow.ToString('o')
$index.profiles += @{ id=$id; name=$manifest.name; createdAt=$now; updatedAt=$now }
Write-FixtureJson $indexPath $index
$null = Get-InactiveImportAudit $casePath 'Imported'
$results.Add(@{ name='authored imported state accepted'; passed=$true })
$exportPath = Join-Path $casePath 'exports/native-multiple-huds-v018.zip'
Copy-Item -LiteralPath $archivePath -Destination $exportPath
$null = Get-InactiveImportAudit $casePath 'Exported'
$results.Add(@{ name='authored export with ten exact payloads accepted'; passed=$true })
Assert-Refusal 'no native session evidence cannot reopen' { Assert-InactiveImportReopen $casePath }

$incoming = Join-Path $casePath 'roaming/execs/profiles/blobs/sha256/.incoming'
[IO.Directory]::CreateDirectory($incoming) | Out-Null
$null = Get-InactiveImportAudit $casePath 'Exported'
$results.Add(@{ name='exact empty ordinary blob incoming container accepted after import'; passed=$true })
$incomingFile = Join-Path $incoming 'unfinished'
[IO.File]::WriteAllText($incomingFile, 'must refuse')
try { Assert-Refusal 'nonempty blob incoming container rejected' { Get-InactiveImportAudit $casePath 'Exported' } }
finally { Remove-Item -LiteralPath $incomingFile }
Remove-Item -LiteralPath $incoming
[IO.File]::WriteAllText($incoming, 'not a directory')
try { Assert-Refusal 'non-directory blob incoming container rejected' { Get-InactiveImportAudit $casePath 'Exported' } }
finally { Remove-Item -LiteralPath $incoming; [IO.Directory]::CreateDirectory($incoming) | Out-Null }

$livePath = Join-Path $casePath 'tf2-root/tf/cfg/autoexec.cfg'
$liveBytes = [IO.File]::ReadAllBytes($livePath)
try {
    [IO.File]::WriteAllText($livePath, 'changed sentinel')
    Assert-Refusal 'synthetic live drift rejected' { Get-InactiveImportAudit $casePath 'Exported' }
} finally { [IO.File]::WriteAllBytes($livePath, $liveBytes) }

$index.activeProfileId = $id
Write-FixtureJson $indexPath $index
try { Assert-Refusal 'non-null active profile rejected' { Get-InactiveImportAudit $casePath 'Exported' } }
finally { $index.activeProfileId = $null; Write-FixtureJson $indexPath $index }

$manifest.cloudSyncPending = $true
Write-FixtureJson $manifestPath $manifest
try { Assert-Refusal 'unexpected pending Cloud state rejected' { Get-InactiveImportAudit $casePath 'Exported' } }
finally { [void]$manifest.Remove('cloudSyncPending'); Write-FixtureJson $manifestPath $manifest }

$manifest.preloader.addons = @('unexpected-selection')
Write-FixtureJson $manifestPath $manifest
try { Assert-Refusal 'nonempty imported preloader rejected' { Get-InactiveImportAudit $casePath 'Exported' } }
finally { $manifest.preloader.addons = @(); Write-FixtureJson $manifestPath $manifest }

$journal = Join-Path $profile '.mutation-journal.json'
[IO.File]::WriteAllText($journal, '{}')
try { Assert-Refusal 'recovery journal rejected' { Get-InactiveImportAudit $casePath 'Exported' } }
finally { Remove-Item -LiteralPath $journal }

$staging = Join-Path $casePath 'roaming/execs/profiles/.import-staging'
[IO.Directory]::CreateDirectory($staging) | Out-Null
try { Assert-Refusal 'empty staging directory rejected' { Get-InactiveImportAudit $casePath 'Exported' } }
finally { Remove-Item -LiteralPath $staging }

$exportBytes = [IO.File]::ReadAllBytes($exportPath)
$zip = [IO.Compression.ZipFile]::Open($exportPath, [IO.Compression.ZipArchiveMode]::Update)
try {
    $entry = $zip.GetEntry('files/tf/cfg/overrides/compat.cfg')
    $entry.Delete()
    $entry = $zip.CreateEntry('files/tf/cfg/overrides/compat.cfg')
    $stream = $entry.Open()
    try { $bytes = [Text.Encoding]::UTF8.GetBytes('altered export'); $stream.Write($bytes,0,$bytes.Length) }
    finally { $stream.Dispose() }
} finally { $zip.Dispose() }
try { Assert-Refusal 'altered export payload rejected' { Get-InactiveImportAudit $casePath 'Exported' } }
finally { [IO.File]::WriteAllBytes($exportPath, $exportBytes) }

$requestPath = Join-Path $casePath 'request.json'
$requestBytes = [IO.File]::ReadAllBytes($requestPath)
$request = Get-Content -LiteralPath $requestPath -Raw | ConvertFrom-Json -AsHashtable
$request.executableSha256 = '0' * 64
Write-FixtureJson $requestPath $request
try { Assert-Refusal 'changed executable identity rejected' { Get-InactiveImportAudit $casePath 'Exported' } }
finally { [IO.File]::WriteAllBytes($requestPath, $requestBytes) }
$null = Get-InactiveImportAudit $casePath 'Exported'
$results.Add(@{ name='exact state accepted after restoration'; passed=$true })
$report = [ordered]@{ passed=$true; checkedUtc=[DateTime]::UtcNow.ToString('o'); caseDirectory=$casePath; checks=@($results); count=$results.Count; note='Validator self-test with authored files only. No native app, import IPC, export IPC, Steam, Cloud, or GUI was executed. This directory is not a native qualification case and contains no launch/exit records.' }
Write-FixtureJson (Join-Path $casePath 'validator-selftest.json') $report
ConvertTo-Json -InputObject $report -Depth 10
