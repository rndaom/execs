# Read-only verification after native inactive-library navigation/import cancellation.
# The only optional write is a new evidence report outside the compared fixture trees.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$CaseDirectory,
    [Parameter(Mandatory=$true)][string]$ExpectedExecutableSha256,
    [string]$ReportPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$casePath = [IO.Path]::GetFullPath($CaseDirectory).TrimEnd('\')
$allowedRoot = 'G:\Projects\execs\.artifacts\native-isolation\'
if (-not $casePath.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Expected an explicit local QA case directory.' }
$walk = $casePath
while ($walk) {
    if (((Get-Item -LiteralPath $walk -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Linked case boundary: $walk" }
    $parent = [IO.Directory]::GetParent($walk)
    if ($null -eq $parent) { break }
    $walk = $parent.FullName
}
. (Join-Path $PSScriptRoot 'InactiveLibraryFixture.ps1')
$request = Get-Content -LiteralPath (Join-Path $casePath 'request.json') -Raw | ConvertFrom-Json
$baseline = Get-Content -LiteralPath (Join-Path $casePath 'inactive-library-baseline.json') -Raw | ConvertFrom-Json -AsHashtable
$launch = Get-Content -LiteralPath (Join-Path $casePath 'launch.json') -Raw | ConvertFrom-Json
$exit = Get-Content -LiteralPath (Join-Path $casePath 'exit.json') -Raw | ConvertFrom-Json
if ($request.scenario -ne 'InactiveLibrary' -or $request.inactiveFixture.profileIds.Count -ne 2) { throw 'Unexpected fixture scenario.' }
Assert-InactiveLibraryFixture $casePath
$actual = Get-FixtureSnapshot $casePath
$removed = @($baseline.Keys | Where-Object { -not $actual.Contains($_) } | Sort-Object)
$added = @($actual.Keys | Where-Object { -not $baseline.Contains($_) } | Sort-Object)
$changed = @($baseline.Keys | Where-Object { $actual.Contains($_) -and $baseline[$_] -ne $actual[$_] } | Sort-Object)
$index = Get-Content -LiteralPath (Join-Path $casePath 'roaming/execs/profiles/index.json') -Raw | ConvertFrom-Json
$expectedIds = @($request.inactiveFixture.profileIds | Sort-Object)
$actualIds = @($index.profiles | ForEach-Object { $_.id } | Sort-Object)
$forbidden = @('roaming/execs/maintenance', 'roaming/execs/preloader', 'roaming/execs/profiles/.delete-journal.json', 'roaming/execs/profiles/.import-staging')
$remnants = @($forbidden | Where-Object { Test-Path -LiteralPath (Join-Path $casePath $_) })
$remnants += @($actual.Keys | Where-Object { $_ -match '(^|/)\.mutation-journal\.json$|\.execs-part$' })
$checks = [ordered]@{
    exactCandidateIdentity = ($request.executableSha256 -eq $ExpectedExecutableSha256 -and $launch.executableSha256 -eq $ExpectedExecutableSha256)
    unpackagedExplorerHelperAndApp = ($launch.helperParentName -eq 'explorer.exe' -and $launch.helperParentPackageCode -eq 15700 -and $launch.helperPackageCode -eq 15700 -and $launch.appPackageCode -eq 15700)
    normalExit = ($exit.exitCode -eq 0 -and $exit.appPid -eq $launch.appPid)
    fixtureAssertionPassed = $true
    exactFileInventory = ($baseline.Count -eq $actual.Count -and $removed.Count -eq 0 -and $added.Count -eq 0)
    allBytesUnchanged = ($changed.Count -eq 0)
    activeProfileRemainsNull = ($null -eq $index.activeProfileId)
    bothExpectedProfilesRemain = ($actualIds.Count -eq 2 -and ($actualIds -join "`n") -eq ($expectedIds -join "`n"))
    noRecoveryOrStagingRemnants = ($remnants.Count -eq 0)
}
$passed = @($checks.Values | Where-Object { -not $_ }).Count -eq 0
$report = [ordered]@{
    passed=$passed
    checkedUtc=[DateTime]::UtcNow.ToString('o')
    caseDirectory=$casePath
    executableSha256=$launch.executableSha256
    appPid=$launch.appPid
    appExitedUtc=$exit.exitedUtc
    profileIds=$actualIds
    baselineSha256=(Get-FileHash -LiteralPath (Join-Path $casePath 'inactive-library-baseline.json') -Algorithm SHA256).Hash
    baselineFiles=$baseline.Count
    actualFiles=$actual.Count
    unchangedFiles=($baseline.Count - $removed.Count - $changed.Count)
    checks=$checks
    removedFiles=$removed
    changedFiles=$changed
    addedFiles=$added
    remnants=$remnants
    actualSha256=$actual
    note='Read-only post-cancel comparison of disposable app-data/library/import/synthetic-live files. Browser caches and OS files are outside this comparison. No fixture file was changed by this validator.'
}
$json = (ConvertTo-Json -InputObject $report -Depth 12).Replace("`r`n","`n") + "`n"
if ($ReportPath) {
    $output = [IO.Path]::GetFullPath($ReportPath)
    if ([IO.Path]::GetDirectoryName($output) -ne $casePath) { throw 'The evidence report must be a new file directly inside this QA case.' }
    if (Test-Path -LiteralPath $output) { throw 'Refusing to overwrite a previous validation report.' }
    [IO.File]::WriteAllText($output, $json, [Text.UTF8Encoding]::new($false))
}
Write-Output $json
if (-not $passed) { throw 'Post-cancel integrity validation failed; inspect the recorded checks.' }
