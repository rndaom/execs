param([Parameter(Mandatory)][string]$CaseDirectory)
$ErrorActionPreference = 'Stop'
$qaRoot = [IO.Path]::GetFullPath('G:\Projects\execs\.artifacts\native-isolation').TrimEnd('\') + '\'
$casePath = [IO.Path]::GetFullPath($CaseDirectory).TrimEnd('\')
if (-not $casePath.StartsWith($qaRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Expected an owned native fixture case.' }
$settingsPath = Join-Path $casePath 'roaming\execs\settings.json'
$request = Get-Content -Raw -LiteralPath (Join-Path $casePath 'request.json') | ConvertFrom-Json
$settings = Get-Content -Raw -LiteralPath $settingsPath | ConvertFrom-Json
if ($request.scenario -ne 'Rootless' -or $settings.tf2Root -ne '') { throw 'Only a rootless case can be locked.' }
$walk = $settingsPath
while ($walk) {
  $item = Get-Item -LiteralPath $walk -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Refusing linked fixture paths.' }
  $parent = [IO.Directory]::GetParent($walk)
  if ($null -eq $parent) { break }
  $walk = $parent.FullName
}
$releasePath = Join-Path $casePath 'release-settings-lock'
if (Test-Path -LiteralPath $releasePath) { throw 'A released lock case cannot be reused.' }
Copy-Item -LiteralPath $settingsPath -Destination (Join-Path $casePath 'settings-before-failure.json') -ErrorAction Stop
$beforeHash = (Get-FileHash -LiteralPath $settingsPath -Algorithm SHA256).Hash
$lockStream = [IO.File]::Open($settingsPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
try {
  $report = [ordered]@{ pid=$PID; path=$settingsPath; sha256=$beforeHash; startedUtc=[DateTime]::UtcNow.ToString('o'); maximumSeconds=300 }
  [IO.File]::WriteAllText((Join-Path $casePath 'settings-lock.json'), ($report | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  Write-Output 'Private rootless settings file locked. Create release-settings-lock in this case to release; automatic release after five minutes.'
  $deadline = [DateTime]::UtcNow.AddSeconds(300)
  while ([DateTime]::UtcNow -lt $deadline -and -not (Test-Path -LiteralPath $releasePath)) { Start-Sleep -Milliseconds 200 }
} finally {
  $lockStream.Dispose()
  [IO.File]::WriteAllText((Join-Path $casePath 'settings-lock-released.json'), (@{ releasedUtc=[DateTime]::UtcNow.ToString('o'); pid=$PID } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  Write-Output 'Private settings lock released.'
}
