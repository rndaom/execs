function ConvertTo-ProcessUtcTicks($Created) {
    if ($Created -is [DateTime]) {
        return $Created.ToUniversalTime().Ticks
    }
    if ($Created -isnot [string]) { throw 'Invalid process creation time.' }
    return [DateTime]::ParseExact(
        $Created,
        'o',
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::RoundtripKind
    ).ToUniversalTime().Ticks
}

function Test-ProcessCreatedMatch($Actual, $Expected) {
    (ConvertTo-ProcessUtcTicks $Actual) -eq (ConvertTo-ProcessUtcTicks $Expected)
}

function Test-FullyQualifiedWindowsPath([string]$Path) {
    # .NET Framework in Windows PowerShell 5.1 lacks Path.IsPathFullyQualified.
    # IsPathRooted is insufficient: C:child and \child still depend on the cwd/drive.
    return $Path -match '^[A-Za-z]:[\\/]' -or
        $Path -match '^[\\/]{2}(?![.?][\\/])[^\\/]+[\\/][^\\/]+'
}

function Test-SendKeysLiteralPath([string]$Path) {
    if (-not (Test-FullyQualifiedWindowsPath $Path) -or $Path -match '[\x00-\x1f]') { return $false }
    foreach ($special in @('+', '^', '%', '~', '(', ')', '{', '}', '[', ']')) {
        if ($Path.Contains($special)) { return $false }
    }
    return $true
}

function Test-SaveEnterReadiness([string]$FieldValue, [string]$Destination, [bool]$FilenameFocused,
    [bool]$SaveEnabled, [bool]$SaveVisible, [long]$DefaultButtonResult) {
    if ($FieldValue -cne $Destination -or -not $FilenameFocused -or -not $SaveEnabled -or -not $SaveVisible) { return $false }
    # DM_GETDEFID: high word DC_HASDEFID (0x534b), low word IDOK/Save (1).
    return ((($DefaultButtonResult -shr 16) -band 0xffff) -eq 0x534b -and
        ($DefaultButtonResult -band 0xffff) -eq 1)
}

function Assert-Contained([string]$Root, [string]$Path, [bool]$MissingLeaf = $false) {
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $full = [IO.Path]::GetFullPath($Path)
    if (-not (Test-FullyQualifiedWindowsPath $Path) -or -not $full.StartsWith($rootFull + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Outside owned root: $Path" }
    $current = Get-Item -LiteralPath $rootFull -Force
    if (-not $current.PSIsContainer -or ($current.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid owned root.' }
    $parts = $full.Substring($rootFull.Length + 1).Split('\')
    for ($i = 0; $i -lt $parts.Length; $i++) {
        $next = Join-Path $current.FullName $parts[$i]
        if (-not (Test-Path -LiteralPath $next)) {
            if ($MissingLeaf -and $i -eq $parts.Length - 1) { return $full }
            throw "Missing path: $next"
        }
        $current = Get-Item -LiteralPath $next -Force
        if ($current.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse point refused: $next" }
    }
    return $full
}

function Test-OwnedConsoleHost($Record, $Expected, $Processes, $ParentRecord, [string]$OwnedRoot, [string]$WindowsDirectory) {
    if (-not $ParentRecord) { return $false }
    $consolePath = [IO.Path]::GetFullPath([IO.Path]::Combine($WindowsDirectory, 'System32', 'conhost.exe'))
    if (-not $Record.executable.Equals($consolePath, [StringComparison]::OrdinalIgnoreCase) -or
        [int]$Record.parent -ne [int]$Expected.parent) { return $false }
    $parents = @($Processes | Where-Object { [int]$_.pid -eq [int]$Expected.parent })
    if ($parents.Count -ne 1) { return $false }
    $driverPath = [IO.Path]::GetFullPath([IO.Path]::Combine($OwnedRoot, 'downloads', 'msedgedriver.exe'))
    return $parents[0].executable.Equals($driverPath, [StringComparison]::OrdinalIgnoreCase) -and
        [int]$ParentRecord.pid -eq [int]$parents[0].pid -and
        $ParentRecord.executable.Equals($parents[0].executable, [StringComparison]::OrdinalIgnoreCase) -and
        (Test-ProcessCreatedMatch $ParentRecord.created $parents[0].created)
}

function Assert-ExportDialogIdentity($Dialog, $Windows, [int]$ExpectedPid, [long]$ForegroundHandle) {
    $observed = @($Windows)
    $main = @($observed | Where-Object {
        $_.title -ceq 'execs' -and $_.class -ceq 'Tauri Window' -and $_.visible -and
        [int]$_.pid -eq $ExpectedPid -and [int]$_.nativePid -eq $ExpectedPid -and [long]$_.handle -gt 0
    })
    $nativeDialogs = @($observed | Where-Object { $_.class -ceq '#32770' -and $_.visible })
    if ($main.Count -ne 1 -or $nativeDialogs.Count -ne 1) { throw 'Expected one owned main window and one native dialog.' }
    $save = $nativeDialogs[0]
    if ($save.title -cne 'Export profile' -or [long]$save.handle -le 0 -or
        [int]$save.pid -ne $ExpectedPid -or [int]$save.nativePid -ne $ExpectedPid -or
        [long]$Dialog.handle -ne [long]$save.handle -or [long]$ForegroundHandle -ne [long]$save.handle) {
        throw 'Export dialog identity or foreground changed.'
    }
    if ([long]$save.owner -eq [long]$main[0].handle) { return 'main-window-owned' }
    if ([long]$save.owner -eq 0) { return 'process-owned-top-level' }
    throw 'Export dialog has an unexpected window owner.'
}

function Get-ExportCandidateFiles([string]$Destination, [string]$Documents, [string]$SuggestedName = '') {
    if (-not (Test-FullyQualifiedWindowsPath $Destination) -or -not [IO.Path]::GetFileName($Destination)) {
        throw 'Invalid export diagnostic path.'
    }
    $name = [IO.Path]::GetFileName($Destination)
    $candidates = @(@{ label = 'exact'; path = $Destination }, @{ label = 'adjacent-appended-zip'; path = $Destination + '.zip' })
    if ($Documents -and (Test-Path -LiteralPath $Documents -PathType Container)) {
        if (-not (Test-FullyQualifiedWindowsPath $Documents)) { throw 'Invalid Documents diagnostic path.' }
        $candidates += @(@{ label = 'documents-basename'; path = (Join-Path $Documents $name) },
            @{ label = 'documents-appended-zip'; path = (Join-Path $Documents ($name + '.zip')) })
        if ($SuggestedName) {
            if ($SuggestedName -notmatch '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,127}\.zip$') { throw 'Invalid suggested export name.' }
            $candidates += @{ label = 'documents-suggested-name'; path = (Join-Path $Documents $SuggestedName) }
        }
    }
    @($candidates | ForEach-Object {
        $item = Get-Item -LiteralPath $_.path -ErrorAction SilentlyContinue
        @{ label = $_.label; path = $_.path; exists = ($null -ne $item -and -not $item.PSIsContainer)
            bytes = $(if ($item -and -not $item.PSIsContainer) { $item.Length } else { $null }) }
    })
}
