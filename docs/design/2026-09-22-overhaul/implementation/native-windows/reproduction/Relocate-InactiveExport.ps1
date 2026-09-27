# Explicit correction for the observed native picker destination mismatch.
# Moves only the already-verified default-name ZIP within the same private case.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$CaseDirectory)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'InactiveImportFixture.ps1')
$casePath = Assert-InactiveImportCasePath $CaseDirectory
if (@(Get-CimInstance Win32_Process -Filter "Name='execs.exe'").Count -gt 0) { throw 'Close execs normally before relocating its completed export.' }
$session = Assert-InactiveImportSession $casePath
$before = Get-InactiveImportTree $casePath
$sourceRelative = 'imports/Actual public v0.1.8 export.zip'
$destinationRelative = 'exports/native-multiple-huds-v018.zip'
$source = [IO.Path]::GetFullPath((Join-Path $casePath $sourceRelative))
$destination = [IO.Path]::GetFullPath((Join-Path $casePath $destinationRelative))
$prefix = $casePath + '\'
foreach ($path in @($source,$destination)) {
    if (-not $path.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Relocation endpoint escaped its explicit case.' }
    $parent = (Resolve-Path -LiteralPath ([IO.Path]::GetDirectoryName($path))).Path
    if (-not $parent.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Resolved relocation parent escaped its case.' }
}
if (Test-Path -LiteralPath $destination) { throw 'The planned export destination must remain absent.' }
$sourceItem = Get-Item -LiteralPath $source -Force
if ($sourceItem.PSIsContainer -or ($sourceItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'The observed export must be an ordinary file.' }
$hashBefore = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
if ($hashBefore -ne 'BE5F3472308C176CB88F6C604D1592C275EED58B9602AC65F4DAADF57E7AE552') { throw 'The observed native export differs from the reviewed exact ZIP.' }
$original = Read-InactiveImportArchive (Join-Path $casePath 'imports/review-multiple-huds-v018.zip')
$export = Read-InactiveImportArchive $source
$expectedManifest = ConvertTo-Json -InputObject $original.manifest -Depth 40 | ConvertFrom-Json -AsHashtable
$expectedManifest.hudSelectedRoot = 'secondhud'
$expectedManifest.hudReviewPending = $true
$expectedManifest.preloader = @{addons=@();particleMods=@();profileParticleMods=@()}
Assert-InactiveImportJsonEqual $export.manifest $expectedManifest 'observed native export metadata'
foreach ($member in $original.members.Keys) {
    if ($member -ne 'execs-profile.json' -and $original.members[$member] -cne $export.members[$member]) { throw "Observed export payload differs: $member" }
}
$record = [ordered]@{
    recordedUtc=[DateTime]::UtcNow.ToString('o'); caseDirectory=$casePath; session=$session
    actualNativeExportPath=$source; plannedDestination=$destination; originalLength=$sourceItem.Length
    originalCreatedUtc=$sourceItem.CreationTimeUtc.ToString('o'); originalModifiedUtc=$sourceItem.LastWriteTimeUtc.ToString('o')
    sha256Before=$hashBefore; payloadsVerified=10; sourceAndDestinationParentsResolvedWithinCase=$true
    note='The root operator reported setting the intended absolute Save path, but filesystem evidence showed the native default filename in imports. This explicit same-case relocation corrects the artifact location only; it does not claim that the native picker accepted the intended destination.'
}
$beforeReport = Join-Path $casePath 'export-relocation-before.json'
$afterReport = Join-Path $casePath 'export-relocation.json'
if ((Test-Path -LiteralPath $beforeReport) -or (Test-Path -LiteralPath $afterReport)) { throw 'A relocation record already exists; refusing to repeat it.' }
Write-FixtureJson $beforeReport $record
Move-Item -LiteralPath $source -Destination $destination
$hashAfter = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
if ($hashAfter -ne $hashBefore -or (Test-Path -LiteralPath $source)) { throw 'Relocation hash/path verification failed.' }
$after = Get-InactiveImportTree $casePath
$expectedFiles = [ordered]@{}
foreach ($key in $before.files.Keys) {
    if ($key -ceq $sourceRelative) { $expectedFiles[$destinationRelative] = $before.files[$key] }
    else { $expectedFiles[$key] = $before.files[$key] }
}
Assert-InactiveImportJsonEqual $after.files $expectedFiles 'file inventory after the single export relocation'
$record.sha256After = $hashAfter
$record.completedUtc = [DateTime]::UtcNow.ToString('o')
$record.allOtherFixtureFilesUnchanged = $true
$record.unchangedOtherFiles = $after.files.Count - 1
$record.sourceAbsentAfter = $true
Write-FixtureJson $afterReport $record
ConvertTo-Json -InputObject $record -Depth 10
