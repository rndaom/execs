# Read-only comparison of an executed disposable fixture against its preparation baseline.
# The only optional write is a JSON evidence report; app/profile/TF2 files are never changed.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$CaseDirectory,
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
$request = Get-Content -LiteralPath (Join-Path $casePath 'request.json') -Raw | ConvertFrom-Json
$baseline = Get-Content -LiteralPath (Join-Path $casePath 'inactive-library-baseline.json') -Raw | ConvertFrom-Json -AsHashtable
$launch = Get-Content -LiteralPath (Join-Path $casePath 'launch.json') -Raw | ConvertFrom-Json
$exit = Get-Content -LiteralPath (Join-Path $casePath 'exit.json') -Raw | ConvertFrom-Json
if ($request.scenario -ne 'InactiveLibrary' -or $request.inactiveFixture.profileIds.Count -ne 2) { throw 'Unexpected fixture scenario.' }
$deletedId = [string]$request.inactiveFixture.profileIds[0]
$retainedId = [string]$request.inactiveFixture.profileIds[1]
$deletedPrefix = "roaming/execs/profiles/$deletedId/"
$retainedPrefix = "roaming/execs/profiles/$retainedId/"
$indexRelative = 'roaming/execs/profiles/index.json'
$actual = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
$directories = [Collections.Generic.List[string]]::new()
foreach ($relativeRoot in @('roaming\execs', 'tf2-root', 'imports')) {
    $queue = [Collections.Generic.Queue[string]]::new()
    $queue.Enqueue((Join-Path $casePath $relativeRoot))
    while ($queue.Count -gt 0) {
        $directory = $queue.Dequeue()
        if (((Get-Item -LiteralPath $directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Linked fixture directory: $directory" }
        $directories.Add($directory.Substring($casePath.Length + 1).Replace('\','/'))
        foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Linked fixture entry: $($item.FullName)" }
            if ($item.PSIsContainer) { $queue.Enqueue($item.FullName) }
            else {
                $relative = $item.FullName.Substring($casePath.Length + 1).Replace('\','/')
                $actual.Add($relative, (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash)
            }
        }
    }
}
$removed = @($baseline.Keys | Where-Object { -not $actual.ContainsKey($_) } | Sort-Object)
$added = @($actual.Keys | Where-Object { -not $baseline.Contains($_) } | Sort-Object)
$changed = @($baseline.Keys | Where-Object { $actual.ContainsKey($_) -and $baseline[$_] -ne $actual[$_] } | Sort-Object)
$expectedRemoved = @($baseline.Keys | Where-Object { $_.StartsWith($deletedPrefix, [StringComparison]::Ordinal) } | Sort-Object)
$unchanged = @($baseline.Keys | Where-Object { $actual.ContainsKey($_) -and $baseline[$_] -eq $actual[$_] } | Sort-Object)
$index = Get-Content -LiteralPath (Join-Path $casePath $indexRelative) -Raw | ConvertFrom-Json
$sources = @(Get-Content -LiteralPath (Join-Path $casePath 'inactive-library-sources.json') -Raw | ConvertFrom-Json)
$retainedSource = $sources | Where-Object id -EQ $retainedId | Select-Object -First 1
$forbidden = @('roaming/execs/maintenance', 'roaming/execs/preloader', 'roaming/execs/profiles/.delete-journal.json', 'roaming/execs/profiles/.import-staging')
$remnants = @($forbidden | Where-Object { Test-Path -LiteralPath (Join-Path $casePath $_) })
$remnants += @($actual.Keys | Where-Object { $_ -match '(^|/)\.mutation-journal\.json$|\.execs-part$' })
$checks = [ordered]@{
    exactCandidateIdentity = ($request.executableSha256 -eq $launch.executableSha256)
    unpackagedExplorerHelperAndApp = ($launch.helperParentName -eq 'explorer.exe' -and $launch.helperParentPackageCode -eq 15700 -and $launch.helperPackageCode -eq 15700 -and $launch.appPackageCode -eq 15700)
    normalExit = ($exit.exitCode -eq 0 -and $exit.appPid -eq $launch.appPid)
    onlyExpectedTargetFilesRemoved = ($expectedRemoved.Count -gt 0 -and ($removed -join "`n") -eq ($expectedRemoved -join "`n"))
    targetDirectoryRemoved = (-not (Test-Path -LiteralPath (Join-Path $casePath ("roaming/execs/profiles/$deletedId"))))
    noFilesAdded = ($added.Count -eq 0)
    onlyIndexBytesChanged = ($changed.Count -eq 1 -and $changed[0] -eq $indexRelative)
    indexSchemaAndRootRetained = ($index.schema -eq 1 -and $index.tf2Root -eq $request.inactiveFixture.root)
    activeProfileRemainsNull = ($null -eq $index.activeProfileId)
    exactlyExpectedProfileRemains = ($index.profiles.Count -eq 1 -and $index.profiles[0].id -eq $retainedId -and $index.profiles[0].name -eq $retainedSource.name)
    noPendingSwitchFields = (@($index.PSObject.Properties.Name | Where-Object { $_ -in @('pendingSwitch','interruptedProfileId') }).Count -eq 0)
    noRecoveryOrStagingRemnants = ($remnants.Count -eq 0)
}
$preservedGroups = [ordered]@{}
foreach ($group in @(
    @{ Name='retainedProfile'; Prefix=$retainedPrefix },
    @{ Name='sharedBlobs'; Prefix='roaming/execs/profiles/blobs/' },
    @{ Name='syntheticLiveRoot'; Prefix='tf2-root/' },
    @{ Name='importArchive'; Prefix='imports/' },
    @{ Name='settings'; Prefix='roaming/execs/settings.json' }
)) {
    $members = @($baseline.Keys | Where-Object { $_.StartsWith($group.Prefix, [StringComparison]::Ordinal) })
    $same = $members.Count -gt 0 -and @($members | Where-Object { -not $actual.ContainsKey($_) -or $actual[$_] -ne $baseline[$_] }).Count -eq 0
    $preservedGroups[$group.Name] = [ordered]@{ files=$members.Count; allBytesUnchanged=$same }
    $checks[$group.Name + 'Unchanged'] = $same
}
$passed = @($checks.Values | Where-Object { -not $_ }).Count -eq 0
$actualHashes = [ordered]@{}
foreach ($key in @($actual.Keys | Sort-Object)) { $actualHashes[$key] = $actual[$key] }
$report = [ordered]@{
    passed=$passed
    checkedUtc=[DateTime]::UtcNow.ToString('o')
    caseDirectory=$casePath
    executableSha256=$launch.executableSha256
    appPid=$launch.appPid
    appExitedUtc=$exit.exitedUtc
    deletedProfileId=$deletedId
    retainedProfileId=$retainedId
    baselineSha256=(Get-FileHash -LiteralPath (Join-Path $casePath 'inactive-library-baseline.json') -Algorithm SHA256).Hash
    baselineFiles=$baseline.Count
    actualFiles=$actual.Count
    unchangedFiles=$unchanged.Count
    checks=$checks
    preservedGroups=$preservedGroups
    removedFiles=$removed
    changedFiles=$changed
    addedFiles=$added
    remnants=$remnants
    actualSha256=$actualHashes
    note='Read-only post-delete validation of disposable app-data/library/import/synthetic-live files. Browser caches and OS files are outside this comparison. No fixture file was changed by this validator.'
}
$json = (ConvertTo-Json -InputObject $report -Depth 12).Replace("`r`n","`n") + "`n"
if ($ReportPath) {
    $output = [IO.Path]::GetFullPath($ReportPath)
    if (-not $output.StartsWith($casePath + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'The evidence report must be a new file inside this QA case.' }
    if (Test-Path -LiteralPath $output) { throw 'Refusing to overwrite a previous validation report.' }
    [IO.File]::WriteAllText($output, $json, [Text.UTF8Encoding]::new($false))
}
Write-Output $json
if (-not $passed) { throw 'Post-delete integrity validation failed; inspect the recorded checks.' }
