# Read-only native inactive import/export validation; optional evidence JSON only.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$CaseDirectory,
    [ValidateSet('Initial','Imported','Exported','Reopened')][string]$Phase = 'Exported',
    [string]$ReportPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'InactiveImportFixture.ps1')
$casePath = Assert-InactiveImportCasePath $CaseDirectory
$auditPhase = if ($Phase -eq 'Reopened') { 'Exported' } else { $Phase }
$audit = Get-InactiveImportAudit $casePath $auditPhase
$audit.phase = $Phase
if ($Phase -in @('Exported','Reopened')) {
    $audit.session = Assert-InactiveImportSession $casePath
    if ($Phase -eq 'Reopened') {
        $prior = Get-Content -LiteralPath (Join-Path $casePath 'import-export-session/post-import-export-integrity.json') -Raw | ConvertFrom-Json -AsHashtable
        if (-not $prior.passed -or $prior.phase -cne 'Exported' -or $prior.executableSha256 -ne $audit.executableSha256 -or $prior.importedProfileId -cne $audit.importedProfileId -or $audit.session.launchedUtc -le $prior.session.exitedUtc) { throw 'Reopen must follow the validated original native session with the same binary/profile.' }
        Assert-InactiveImportJsonEqual $audit.actualSha256 $prior.actualSha256 'exact persisted state after reopen'
        $audit.previousSession = $prior.session
        $audit.allPostImportExportBytesUnchanged = $true
    }
}
$json = (ConvertTo-Json -InputObject $audit -Depth 30).Replace("`r`n", "`n") + "`n"
if ($ReportPath) {
    $output = [IO.Path]::GetFullPath($ReportPath)
    if ([IO.Path]::GetDirectoryName($output) -cne $casePath -or (Test-Path -LiteralPath $output)) { throw 'Evidence must be a new file directly inside the case.' }
    [IO.File]::WriteAllText($output, $json, [Text.UTF8Encoding]::new($false))
}
Write-Output $json
