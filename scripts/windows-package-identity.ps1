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
