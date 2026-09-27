param(
    [string]$CasesJson = 'G:\Projects\execs\.artifacts\native-isolation\startup-variants-prepared-20260922.json',
    [string]$EvidenceDirectory = 'G:\Projects\execs\docs\design\2026-09-22-overhaul\implementation\native-windows\startup-variants'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Read-Json([string]$Path) { Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json }
function Hash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
$expectedExe = '7D3BBA6B25B6FEAD1EB0CD1E63E34EFA93BE5E2F46974F355987F847BC53817D'
$cases = @(Read-Json $CasesJson)
$results = foreach ($case in $cases) {
    $dir = [IO.Path]::GetFullPath($case.caseDirectory)
    Assert-True ($dir.StartsWith('G:\Projects\execs\.artifacts\native-isolation\', [StringComparison]::OrdinalIgnoreCase)) 'Fixture is outside the private case directory.'
    Assert-True (@(Get-ChildItem -LiteralPath $dir -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -eq 0) 'Fixture contains a reparse point.'
    $request = Read-Json (Join-Path $dir 'request.json')
    $launch = Read-Json (Join-Path $dir 'launch.json')
    $exit = Read-Json (Join-Path $dir 'exit.json')
    $bootstrap = Read-Json (Join-Path $dir 'bootstrap.json')
    $webviews = @(Read-Json (Join-Path $dir 'webview-processes.json'))
    Assert-True ($request.executableSha256 -eq $expectedExe -and $launch.executableSha256 -eq $expectedExe) 'Wrong executable identity.'
    Assert-True ($launch.startupVariant -eq $case.variant -and $launch.appPid -eq $exit.appPid -and $exit.exitCode -eq 0) 'Wrong variant or abnormal exit.'
    Assert-True ($launch.helperPackageCode -eq 15700 -and $launch.helperParentPackageCode -eq 15700 -and $launch.appPackageCode -eq 15700) 'A process inherited package identity.'
    Assert-True ($launch.helperParentName -eq 'explorer.exe' -and $bootstrap.effectiveExecutionPolicy -eq 'RemoteSigned') 'Unexpected launch host or execution policy.'
    Assert-True ($webviews.Count -eq 0) 'Unexpected WebView process recorded.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $dir 'failure.json'))) 'Launcher failure recorded.'
    $data = Join-Path $dir 'roaming\execs'
    $settings = Join-Path $data 'settings.json'
    $settingsValue = Read-Json $settings
    Assert-True ([string]::IsNullOrEmpty($settingsValue.tf2Root) -and $settingsValue.preferences.motion -eq 'system' -and -not $settingsValue.preferences.checkForUpdatesOnStartup) 'Rootless settings changed.'
    Assert-True ((Hash $settings) -eq $case.settingsSha256 -and (Hash (Join-Path $dir 'fixture-originals\settings.json')) -eq $case.settingsSha256) 'Settings bytes changed.'
    $actualFiles = @(Get-ChildItem -LiteralPath $data -Recurse -File -Force | ForEach-Object { [IO.Path]::GetRelativePath($data, $_.FullName).Replace('\', '/') } | Sort-Object)
    $expectedFiles = @(@('settings.json') + @($request.startupMarkers | ForEach-Object { 'maintenance/' + $_.name }) | Sort-Object)
    Assert-True (($actualFiles -join "`n") -eq ($expectedFiles -join "`n")) 'Unexpected app data file inventory.'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $data 'profiles'))) 'Unexpected profile library.'
    $markerResults = @(foreach ($marker in @($request.startupMarkers)) {
        $path = Join-Path $data ('maintenance\' + $marker.name)
        $original = Join-Path $dir ('fixture-originals\' + $marker.name)
        $recordedAfter = @($exit.startupMarkersAfter | Where-Object name -eq $marker.name)
        Assert-True ((Hash $path) -eq $marker.sha256 -and (Hash $original) -eq $marker.sha256 -and $recordedAfter.Count -eq 1 -and $recordedAfter[0].sha256 -eq $marker.sha256) 'Marker bytes changed.'
        [ordered]@{ name=$marker.name; bytes=(Get-Item -LiteralPath $path).Length; sha256=$marker.sha256; originalAndCurrentExact=$true }
    })
    $maintenance = Join-Path $data 'maintenance'
    $state = 'State location: ' + $maintenance
    $capture = switch ($case.variant) {
        'UnsetAppData' { '01-unset-appdata' }
        'MismatchedToken' { '02-mismatched-token' }
        'MultipleMarkers' { '03-multiple-markers' }
        'UnreadableMarker' { '04-unreadable-marker' }
        default { throw 'Unknown variant.' }
    }
    $expectedReason = switch ($case.variant) {
        'UnsetAppData' {
            Assert-True (-not $launch.appDataEnvironmentPresent -and $null -eq $launch.appData -and -not (Test-Path -LiteralPath $maintenance)) 'APPDATA was not absent or a maintenance directory was created.'
            $state = 'State location: Unavailable: the app data directory could not be resolved.'
            'execs could not start: %APPDATA% is unset or relative, so execs cannot find its settings and profile library.'
        }
        'MismatchedToken' { 'found mismatched maintenance state at ' + (Join-Path $maintenance 'launching-tf2') }
        'MultipleMarkers' { 'found more than one active maintenance operation' }
        'UnreadableMarker' {
            $lock = Read-Json (Join-Path $dir 'startup-marker-lock.json')
            $released = Read-Json (Join-Path $dir 'startup-marker-lock-released.json')
            Assert-True ($lock.helperPid -eq $launch.helperPid -and $released.releasedAfterAppExit -and [datetime]$lock.acquiredUtc -lt [datetime]$launch.launchedUtc -and [datetime]$released.releasedUtc -le [datetime]$exit.exitedUtc) 'Private marker handle lifetime was not recorded correctly.'
            'could not read the maintenance state at ' + (Join-Path $maintenance 'launching-tf2') + ' (The process cannot access the file because it is being used by another process. (os error 32))'
        }
    }
    if ($case.variant -ne 'UnsetAppData') { Assert-True ($launch.appDataEnvironmentPresent -and $launch.appData -eq (Join-Path $dir 'roaming')) 'APPDATA is not isolated.' }
    $stderr = [IO.File]::ReadAllText((Join-Path $dir 'stderr.txt')).Trim()
    $clipboard = [IO.File]::ReadAllText((Join-Path $EvidenceDirectory ($capture + '.clipboard.txt'))).Replace("`r`n", "`n")
    Assert-True ($stderr.Contains($state) -and $stderr.Contains($expectedReason) -and $stderr.Contains('execs 0.2.0') -and $clipboard.Contains($stderr.Replace("`r`n", "`n"))) 'Expected full diagnostic is missing from stderr or the native clipboard copy.'
    [ordered]@{ variant=$case.variant; caseDirectory=$dir; appPid=$launch.appPid; helperPid=$launch.helperPid; exitCode=$exit.exitCode; exitedUtc=$exit.exitedUtc; fullDiagnosticMatchesNativeClipboard=$true; settingsSha256=$case.settingsSha256; settingsUnchanged=$true; appDataFileInventoryExact=$true; noProfileLibrary=$true; recordedWebViewProcesses=0; markers=$markerResults }
}
[ordered]@{ checkedUtc=[datetime]::UtcNow.ToString('o'); readOnly=$true; executableSha256=$expectedExe; caseCount=$results.Count; note='Validates retained records and fixture bytes. Native dialog visibility, absence of a console/main window, and OK interaction are root-operator observations, not inferred by this script.'; cases=@($results) } | ConvertTo-Json -Depth 12
