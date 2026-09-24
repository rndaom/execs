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
