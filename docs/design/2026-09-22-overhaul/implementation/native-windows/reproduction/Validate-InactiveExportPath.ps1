# Read-only export-only path check, reusing the existing inactive fixture audit.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$CaseDirectory,
    [string]$ReportPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'InactiveImportFixture.ps1')
$casePath = Assert-InactiveImportCasePath $CaseDirectory
$expectedBinary = '7D3BBA6B25B6FEAD1EB0CD1E63E34EFA93BE5E2F46974F355987F847BC53817D'
$originalAudit = & (Join-Path $PSScriptRoot 'Validate-InactiveReview.ps1') -CaseDirectory $casePath -ExpectedExecutableSha256 $expectedBinary | ConvertFrom-Json -AsHashtable
$request = Get-Content -LiteralPath (Join-Path $casePath 'request.json') -Raw | ConvertFrom-Json -AsHashtable
$sources = @(Get-Content -LiteralPath (Join-Path $casePath 'inactive-library-sources.json') -Raw | ConvertFrom-Json -AsHashtable)
$profileId = $request.inactiveFixture.profileIds[0]
$source = @($sources | Where-Object { $_.id -ceq $profileId })
if ($source.Count -ne 1 -or $source[0].name -cne 'QA inactive - no HUD' -or $source[0].sourceSha256 -ne '3299CF62CB18DA34785C309803ED2D8ABAD427EAB9B95918EA72B1BF9259AC38') { throw 'Unexpected selected profile source.' }
if ((Get-FileHash -LiteralPath $source[0].source -Algorithm SHA256).Hash -ne $source[0].sourceSha256) { throw 'Retained source archive changed.' }
$tree = Get-InactiveImportTree $casePath
$exportRelative = 'exports/keyboard-path-check.zip'
$exportPath = Join-Path $casePath $exportRelative
$export = Read-InactiveImportArchive $exportPath
$original = Read-InactiveImportArchive $source[0].source
$expectedManifest = ConvertTo-Json -InputObject $original.manifest -Depth 40 | ConvertFrom-Json -AsHashtable
$expectedManifest.name = 'QA inactive - no HUD'
Assert-InactiveImportJsonEqual $export.manifest $expectedManifest 'exported selected-profile manifest'
$payloads = foreach ($file in $original.manifest.files) {
    $member = if ($file.storage -eq 'exclusive') { 'files/' + $file.path } else { 'blobs/' + $file.sha256 }
    if ($export.members[$member] -cne $file.sha256) { throw "Exported payload changed: $member" }
    [ordered]@{ path=$file.path; sourceSha256=$file.sha256; exportedSha256=$export.members[$member]; exact=$true }
}
if (@($payloads).Count -ne 4) { throw 'Expected four selected-profile payloads.' }
$expectedFiles = Get-Content -LiteralPath (Join-Path $casePath 'inactive-library-baseline.json') -Raw | ConvertFrom-Json -AsHashtable
$expectedFiles[$exportRelative] = (Get-FileHash -LiteralPath $exportPath -Algorithm SHA256).Hash
Assert-InactiveImportJsonEqual $tree.files $expectedFiles 'complete fixture inventory plus exactly the planned export'
Assert-InactiveImportDirectories $tree $expectedFiles
$report = [ordered]@{
    passed=$true; checkedUtc=[DateTime]::UtcNow.ToString('o'); caseDirectory=$casePath
    executableSha256=$expectedBinary; appPid=$originalAudit.appPid; exitedUtc=$originalAudit.appExitedUtc
    profileId=$profileId; profileName='QA inactive - no HUD'; activeProfileId=$null
    originalFilesUnchanged=20; originalIndexUnchanged=$true; onlyAddedFile=$exportRelative
    expectedExportPathPresent=$true; exportPath=$exportPath; exportSha256=$expectedFiles[$exportRelative]
    payloads=@($payloads); originalFixtureAudit=$originalAudit
    note='Read-only evidence after the root-operated keyboard-entry Save dialog check. No relocation, import, profile activation, deletion, Cloud/game or installer behavior is part of this case.'
}
$json = (ConvertTo-Json -InputObject $report -Depth 30).Replace("`r`n","`n") + "`n"
if ($ReportPath) {
    $output = [IO.Path]::GetFullPath($ReportPath)
    if ([IO.Path]::GetDirectoryName($output) -cne $casePath -or (Test-Path -LiteralPath $output)) { throw 'Evidence must be a new file directly in the case.' }
    [IO.File]::WriteAllText($output,$json,[Text.UTF8Encoding]::new($false))
}
Write-Output $json
