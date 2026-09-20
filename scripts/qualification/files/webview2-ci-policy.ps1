param(
    [Parameter(Mandatory)][ValidateSet('Apply', 'Restore')][string]$Action,
    [Parameter(Mandatory)][string]$Snapshot,
    [string]$UserDataFolder
)
$ErrorActionPreference = 'Stop'
if ($env:CI -cne 'true' -or $env:RUNNER_OS -ne 'Windows' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'WebView2 policy qualification requires a disposable GitHub-hosted Windows runner.'
}
$scratchRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
foreach ($target in @($Snapshot, $UserDataFolder) | Where-Object { $_ }) {
    if (-not [IO.Path]::GetFullPath($target).StartsWith($scratchRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Policy snapshot and browser profile must stay in runner scratch.'
    }
}
$base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
function Restore-Policy($entries) {
    foreach ($entry in $entries) {
        $key = $base.CreateSubKey($entry.key)
        try {
            if ($entry.existed) {
                $kind = [Enum]::Parse([Microsoft.Win32.RegistryValueKind], [string]$entry.kind)
                $value = $entry.value
                switch ($entry.kind) {
                    'DWord' { $value = [int]$entry.value }
                    'QWord' { $value = [long]$entry.value }
                    'Binary' { $value = [byte[]]$entry.value }
                    'MultiString' { $value = [string[]]$entry.value }
                    default { $value = [string]$entry.value }
                }
                $key.SetValue($entry.name, $value, $kind)
            } else { $key.DeleteValue($entry.name, $false) }
        } finally { $key.Dispose() }
    }
}
try {
    if ($Action -eq 'Restore') {
        Restore-Policy (Get-Content -LiteralPath $Snapshot -Raw | ConvertFrom-Json)
    } else {
        $entries = @()
        foreach ($setting in @('AdditionalBrowserArguments', 'UserDataFolder')) {
            $path = "SOFTWARE\Policies\Microsoft\Edge\WebView2\$setting"
            $key = $base.OpenSubKey($path)
            try {
                foreach ($name in @('execs.exe', 'com.rndaom.execs')) {
                    $existed = $null -ne $key -and $key.GetValueNames() -contains $name
                    $entries += [pscustomobject]@{
                        key = $path; name = $name; existed = $existed
                        kind = $(if ($existed) { $key.GetValueKind($name).ToString() } else { $null })
                        value = $(if ($existed) { $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null })
                    }
                }
            } finally { if ($key) { $key.Dispose() } }
        }
        $entries | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Snapshot -Encoding utf8
        try {
            foreach ($entry in $entries) {
                $key = $base.CreateSubKey($entry.key)
                try {
                    $value = if ($entry.key.EndsWith('UserDataFolder')) { $UserDataFolder } else { '--remote-debugging-port=9227 --remote-debugging-address=127.0.0.1' }
                    $key.SetValue($entry.name, $value, [Microsoft.Win32.RegistryValueKind]::String)
                } finally { $key.Dispose() }
            }
        } catch { Restore-Policy $entries; throw }
    }
} finally { $base.Dispose() }
