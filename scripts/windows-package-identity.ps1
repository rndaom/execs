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
