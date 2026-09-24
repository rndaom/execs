param(
    [Parameter(Mandatory)][ValidateSet('Host', 'PolicyApply', 'PolicyRestore', 'Inspect', 'Save', 'Close', 'Cleanup', 'ExtractDriver')][string]$Action,
    [Parameter(Mandatory)][string]$Request
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:CI -cne 'true' -or $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows' -or
    $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:GITHUB_REPOSITORY -cne 'rndaom/execs' -or
    $env:GITHUB_REF -notmatch '^refs/(heads|pull)/') { throw 'Disposable hosted Windows only.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($identity.User.Value -eq 'S-1-5-18') { throw 'SYSTEM is refused.' }

function Assert-Contained([string]$Root, [string]$Path, [bool]$MissingLeaf = $false) {
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $full = [IO.Path]::GetFullPath($Path)
    if (-not [IO.Path]::IsPathFullyQualified($Path) -or -not $full.StartsWith($rootFull + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Outside owned root: $Path" }
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
if ($Request -ceq '-') {
    if ($Action -notin @('Inspect', 'Cleanup')) { throw 'Only read/cleanup process actions accept stdin.' }
    $buffer = [char[]]::new(1024 * 1024 + 1)
    $length = [Console]::In.ReadBlock($buffer, 0, $buffer.Length)
    if ($length -gt 1024 * 1024) { throw 'Oversized process request.' }
    $r = [string]::new($buffer, 0, $length) | ConvertFrom-Json
} else {
    $null = Assert-Contained $env:RUNNER_TEMP $Request
    $r = Get-Content -LiteralPath $Request -Raw | ConvertFrom-Json
}
$null = Assert-Contained $env:RUNNER_TEMP $r.root
if ($Request -cne '-') { $null = Assert-Contained $r.root $Request }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WindowsPackageNative {
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint id);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern int GetPackageFullName(IntPtr handle, ref uint length, IntPtr name);
    public static int PackageCode(uint pid) {
        IntPtr handle = OpenProcess(0x1000, false, pid);
        if (handle == IntPtr.Zero) throw new Exception("Cannot inspect package identity");
        try { uint length = 0; return GetPackageFullName(handle, ref length, IntPtr.Zero); }
        finally { CloseHandle(handle); }
    }
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    public static uint WindowPid(IntPtr window) { uint pid; GetWindowThreadProcessId(window, out pid); return pid; }
}
'@

function Process-Record($Process) {
    [pscustomobject]@{ pid = [int]$Process.ProcessId; parent = [int]$Process.ParentProcessId
        executable = [string]$Process.ExecutablePath; created = $Process.CreationDate.ToUniversalTime().ToString('o')
        commandLine = [string]$Process.CommandLine; session = [int]$Process.SessionId }
}
function Owned-Process($Expected) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$Expected.pid)"
    if (-not $process) { throw 'Owned process already exited.' }
    $record = Process-Record $process
    if ($record.executable -ine $Expected.executable -or ($Expected.PSObject.Properties['created'] -and $record.created -ne $Expected.created)) { throw 'Process identity changed.' }
    $null = Assert-Contained $r.root $record.executable
    if ([WindowsPackageNative]::PackageCode($record.pid) -ne 15700) { throw 'Packaged app context refused.' }
    return $record
}
function Process-Tree($Expected) {
    $rootProcess = Owned-Process $Expected
    $all = @(Get-CimInstance Win32_Process)
    $records = @($rootProcess)
    for ($iteration = 0; $iteration -lt 8; $iteration++) {
        $ids = @($records | ForEach-Object { $_.pid })
        $extra = @($all | Where-Object { $_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids })
        if ($extra.Count -eq 0) { break }
        $records += @($extra | ForEach-Object { Process-Record $_ })
    }
    if ($records.Count -gt 64) { throw 'Unexpected child process count.' }
    return $records
}

if ($Action -eq 'Host') {
    $players = @(Get-Process | Where-Object { $_.ProcessName -match '^(execs|steam|steamwebhelper|tf_win64|tf_linux64|hl2)$' } | ForEach-Object { @{ name = $_.ProcessName; pid = $_.Id } })
    $steam = @(@('HKCU:\Software\Valve\Steam', 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam') | Where-Object { Test-Path -LiteralPath $_ })
    $locations = @()
    foreach ($path in @((Join-Path $env:APPDATA 'execs'), (Join-Path $env:LOCALAPPDATA 'execs'), (Join-Path $env:LOCALAPPDATA 'com.rndaom.execs'))) {
        if (Test-Path -LiteralPath $path) { $locations += $path }
    }
    foreach ($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
        if (Test-Path -LiteralPath $key) {
            foreach ($child in Get-ChildItem -LiteralPath $key) {
                $value = Get-ItemProperty -LiteralPath $child.PSPath
                $displayName = $value.PSObject.Properties['DisplayName']
                if ($displayName -and [string]$displayName.Value -imatch '^execs(?:\s|$)') { $locations += $child.Name }
            }
        }
    }
    [pscustomobject]@{ sid = $identity.User.Value; user = $identity.Name; session = [Diagnostics.Process]::GetCurrentProcess().SessionId
        userInteractive = [Environment]::UserInteractive; packageCode = [WindowsPackageNative]::PackageCode($PID)
        groups = @($identity.Groups | ForEach-Object { $_.Value }); playerProcesses = $players; steamRegistry = @($steam); productLocations = @($locations) } | ConvertTo-Json -Depth 8
    exit
}

if ($Action -in @('PolicyApply', 'PolicyRestore')) {
    $snapshot = Assert-Contained $r.root $r.snapshot ($Action -eq 'PolicyApply')
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
    function Restore-Entries($Entries) {
        if (@($Entries).Count -ne 4) { throw 'Invalid policy snapshot.' }
        $identities = @()
        foreach ($entry in $Entries) {
            if ($entry.key -notmatch '^SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2\\(AdditionalBrowserArguments|UserDataFolder)$' -or $entry.name -notin @('execs.exe', 'com.rndaom.execs')) { throw 'Unexpected policy entry.' }
            $identities += $entry.key + '|' + $entry.name
        }
        if (@($identities | Select-Object -Unique).Count -ne 4) { throw 'Duplicate policy entry.' }
        foreach ($entry in $Entries) {
            $key = $base.CreateSubKey($entry.key)
            try {
                if ($entry.existed) {
                    $kind = [Enum]::Parse([Microsoft.Win32.RegistryValueKind], [string]$entry.kind)
                    $value = switch ($entry.kind) {
                        'DWord' { [int]$entry.value }; 'QWord' { [long]$entry.value }; 'Binary' { ,([byte[]]$entry.value) }; 'None' { ,([byte[]]$entry.value) }
                        'MultiString' { ,([string[]]$entry.value) }; default { [string]$entry.value }
                    }
                    $key.SetValue($entry.name, $value, $kind)
                } else { $key.DeleteValue($entry.name, $false) }
            } finally { $key.Dispose() }
        }
    }
    try {
        if ($Action -eq 'PolicyRestore') {
            $entries = @(Get-Content -LiteralPath $snapshot -Raw | ConvertFrom-Json)
            Restore-Entries $entries
            foreach ($entry in $entries) {
                $key = $base.OpenSubKey($entry.key)
                try {
                    $exists = $null -ne $key -and $key.GetValueNames() -contains $entry.name
                    if ($exists -ne $entry.existed) { throw 'Policy restoration existence mismatch.' }
                    if ($exists -and ($key.GetValueKind($entry.name).ToString() -ne $entry.kind -or
                        (ConvertTo-Json -InputObject $key.GetValue($entry.name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) -Compress) -ne (ConvertTo-Json -InputObject $entry.value -Compress))) { throw 'Policy restoration content mismatch.' }
                } finally { if ($key) { $key.Dispose() } }
            }
            @{ restored = $true; entries = 4 } | ConvertTo-Json
        } else {
            if (Test-Path -LiteralPath $snapshot) { throw 'Policy snapshot reuse refused.' }
            $userData = Assert-Contained $r.root $r.userData
            if ($r.port -lt 1024 -or $r.port -gt 65535) { throw 'Invalid debugging port.' }
            $entries = @()
            foreach ($setting in @('AdditionalBrowserArguments', 'UserDataFolder')) {
                $path = "SOFTWARE\Policies\Microsoft\Edge\WebView2\$setting"
                $key = $base.OpenSubKey($path)
                try {
                foreach ($name in @('execs.exe', 'com.rndaom.execs')) {
                        $exists = $null -ne $key -and $key.GetValueNames() -contains $name
                        $entries += [pscustomobject]@{ key = $path; name = $name; existed = $exists
                            kind = $(if ($exists) { $key.GetValueKind($name).ToString() } else { $null })
                            value = $(if ($exists) { $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } else { $null }) }
                    }
                } finally { if ($key) { $key.Dispose() } }
            }
            foreach ($entry in $entries) {
                if ($entry.existed -and $entry.kind -notin @('String', 'ExpandString', 'Binary', 'DWord', 'MultiString', 'QWord', 'None')) {
                    throw 'Existing policy value has an unsupported type; nothing was changed.'
                }
            }
            [IO.File]::WriteAllText($snapshot, (ConvertTo-Json -InputObject $entries -Depth 8) + "`n", [Text.UTF8Encoding]::new($false))
            try {
                foreach ($entry in $entries) {
                    $key = $base.CreateSubKey($entry.key)
                    try {
                        $value = if ($entry.key.EndsWith('UserDataFolder')) { $userData } else { "--remote-debugging-port=$($r.port) --remote-debugging-address=127.0.0.1" }
                        $key.SetValue($entry.name, $value, [Microsoft.Win32.RegistryValueKind]::String)
                    } finally { $key.Dispose() }
                }
            } catch { Restore-Entries $entries; throw }
            @{ applied = $true; entries = 4; userData = $userData; port = $r.port } | ConvertTo-Json
        }
    } finally { $base.Dispose() }
    exit
}

if ($Action -eq 'ExtractDriver') {
    $archivePath = Assert-Contained $r.root $r.archive
    $destination = Assert-Contained $r.root $r.destination $true
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $entries = @($archive.Entries | Where-Object { $_.FullName -ceq 'msedgedriver.exe' })
        if ($entries.Count -ne 1 -or $entries[0].Length -gt 80MB -or $entries[0].Length -lt 1) { throw 'Unexpected driver ZIP.' }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0], $destination, $false)
    } finally { $archive.Dispose() }
    $signature = Get-AuthenticodeSignature -LiteralPath $destination
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(?:,|$)') { throw 'Microsoft driver signature unavailable or invalid.' }
    @{ path = $destination; signature = $signature.Status.ToString(); signer = $signature.SignerCertificate.Subject
        version = (Get-Item -LiteralPath $destination).VersionInfo.ProductVersion; sha256 = (Get-FileHash -LiteralPath $destination).Hash } | ConvertTo-Json
    exit
}

if ($Action -eq 'Cleanup') {
    $stopped = @()
    $absent = @()
    $null = Assert-Contained $r.root $r.userData
    if (@($r.processes).Count -eq 0) { @{ forcedCleanup = @(); alreadyExited = @() } | ConvertTo-Json; exit }
    foreach ($expected in @($r.processes)[(@($r.processes).Count - 1)..0]) {
        $observed = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$expected.pid)"
        if (-not $observed) { $absent += [int]$expected.pid; continue }
        $record = Process-Record $observed
        if ($record.created -ne $expected.created -or $record.executable -ine $expected.executable) { throw 'Cleanup process identity changed.' }
        if ($record.executable.StartsWith($r.root + '\', [StringComparison]::OrdinalIgnoreCase)) {
            $null = Assert-Contained $r.root $record.executable
        } elseif ([IO.Path]::GetFileName($record.executable) -ine 'msedgewebview2.exe' -or
            -not $record.commandLine.Contains($r.userData, [StringComparison]::OrdinalIgnoreCase) -or
            $expected.parent -notin @($r.processes.pid)) { throw 'Cleanup target is outside the owned app/driver/browser tree.' }
        $process = Get-Process -Id $record.pid
        if ([Math]::Abs(($process.StartTime.ToUniversalTime() - [DateTime]::Parse($record.created)).Ticks) -ge 10000) { throw 'Cleanup start time changed.' }
        $process.Kill()
        if (-not $process.WaitForExit(5000)) { throw 'Owned cleanup did not exit.' }
        $stopped += $record
    }
    @{ forcedCleanup = $stopped; alreadyExited = $absent } | ConvertTo-Json -Depth 8
    exit
}

$owned = Owned-Process $r.process
$uiError = $null
try {
    $wpf = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\WPF'
    Add-Type -Path (Join-Path $wpf 'UIAutomationTypes.dll'), (Join-Path $wpf 'UIAutomationClient.dll')
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
} catch { $uiError = $_.Exception.Message }
function Windows-ForOwner {
    $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$owned.pid)
    @([Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $condition))
}
function Window-Record($Window) {
    $current = $Window.Current
    @{ title = $current.Name; class = $current.ClassName; handle = $current.NativeWindowHandle; pid = $current.ProcessId
        owner = [WindowsPackageNative]::GetWindow([IntPtr]$current.NativeWindowHandle, 4).ToInt64(); visible = [WindowsPackageNative]::IsWindowVisible([IntPtr]$current.NativeWindowHandle) }
}
if ($Action -eq 'Inspect') {
    $tree = @(Process-Tree $r.process)
    $connections = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -in @($tree.pid) } | ForEach-Object { @{ address = $_.LocalAddress; port = $_.LocalPort; pid = $_.OwningProcess } })
    $windows = @()
    if (-not $uiError) {
        try { $windows = @(Windows-ForOwner | ForEach-Object { Window-Record $_ }) } catch { $uiError = $_.Exception.Message }
    }
    @{ process = $owned; packageCode = [WindowsPackageNative]::PackageCode($owned.pid); processes = $tree
        windows = $windows; uiError = $uiError; listeners = $connections
        version = (Get-Item -LiteralPath $owned.executable).VersionInfo.ProductVersion } | ConvertTo-Json -Depth 10
    exit
}
if ($uiError) { throw "Native UI Automation unavailable: $uiError" }
function Foreground($Window) {
    $handle = [IntPtr]$Window.Current.NativeWindowHandle
    $null = [WindowsPackageNative]::SetForegroundWindow($handle)
    Start-Sleep -Milliseconds 150
    if ([WindowsPackageNative]::GetForegroundWindow() -ne $handle) { throw 'Owned window cannot receive foreground input on this desktop.' }
}
if ($Action -eq 'Close') {
    $windows = @(Windows-ForOwner | Where-Object { $_.Current.Name -ceq 'execs' -and [WindowsPackageNative]::IsWindowVisible([IntPtr]$_.Current.NativeWindowHandle) })
    if ($windows.Count -ne 1) { throw 'Expected one visible owned main window.' }
    Foreground $windows[0]
    $record = Window-Record $windows[0]
    $windows[0].GetCurrentPattern([Windows.Automation.WindowPattern]::Pattern).Close()
    @{ request = 'owned-native-window-close'; window = $record; requestedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Depth 5
    exit
}

$destination = Assert-Contained $r.root $r.destination $true
if (Test-Path -LiteralPath $destination) { throw 'Export destination already exists.' }
$observationPath = Assert-Contained $r.root $r.observation $true
function Save-Observation($Stage, $Windows, $Controls = @(), $FieldValue = $null) {
    $observation = @{ stage = $Stage; at = [DateTime]::UtcNow.ToString('o'); requestedPath = $destination; fieldValue = $FieldValue
        windows = @($Windows | ForEach-Object { Window-Record $_ })
        controls = @($Controls | Select-Object -First 500 | ForEach-Object { @{ name = $_.Current.Name; type = $_.Current.ControlType.ProgrammaticName
            id = $_.Current.AutomationId; enabled = $_.Current.IsEnabled; offscreen = $_.Current.IsOffscreen } }) }
    [IO.File]::WriteAllText($observationPath, (ConvertTo-Json -InputObject $observation -Depth 8) + "`n", [Text.UTF8Encoding]::new($false))
}
$deadline = [DateTime]::UtcNow.AddSeconds(15)
do {
    $null = Owned-Process $r.process
    $windows = @(Windows-ForOwner)
    Save-Observation 'waiting-for-export-dialog' $windows
    $dialogs = @($windows | Where-Object { $_.Current.Name -ceq 'Export profile' -and $_.Current.ClassName -ceq '#32770' })
    if ($dialogs.Count -eq 1) { break }
    if ($dialogs.Count -gt 1 -or [DateTime]::UtcNow -gt $deadline) { throw 'Expected one process-owned Export profile dialog.' }
    Start-Sleep -Milliseconds 100
} while ($true)
$dialog = $dialogs[0]
$controls = @($dialog.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition))
Save-Observation 'dialog-found-before-focus' $windows $controls
Foreground $dialog
$record = Window-Record $dialog
if (-not $record.visible -or $record.owner -eq 0 -or [WindowsPackageNative]::WindowPid([IntPtr]$record.owner) -ne $owned.pid) { throw 'File dialog owner/visibility unknown.' }
$edits = @($controls | Where-Object { $_.Current.ControlType -eq [Windows.Automation.ControlType]::Edit -and $_.Current.AutomationId -ceq '1001' -and $_.Current.Name -ceq 'File name:' })
$buttons = @($controls | Where-Object { $_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and $_.Current.AutomationId -ceq '1' -and $_.Current.Name -match '^Save$' })
if ($edits.Count -ne 1 -or $buttons.Count -ne 1) { throw 'Native Save controls are not unambiguous.' }
$edit = $edits[0]
$edit.SetFocus()
$value = $edit.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
if ($value.Current.IsReadOnly) { throw 'File name is read-only.' }
$value.SetValue($destination)
[Windows.Forms.SendKeys]::SendWait('{TAB}')
Start-Sleep -Milliseconds 150
if ($value.Current.Value -cne $destination) { throw 'Native filename did not accept the requested path.' }
$acceptedValue = $value.Current.Value
Save-Observation 'filename-committed-before-save' $windows $controls $acceptedValue
if ([WindowsPackageNative]::GetForegroundWindow() -ne [IntPtr]$record.handle) { throw 'Save dialog lost foreground.' }
$capture = Assert-Contained $r.root $r.capture $true
$bounds = $dialog.Current.BoundingRectangle
$bitmap = [Drawing.Bitmap]::new([int]$bounds.Width, [int]$bounds.Height)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.CopyFromScreen([int]$bounds.Left, [int]$bounds.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($capture, [Drawing.Imaging.ImageFormat]::Png)
} finally { $graphics.Dispose(); $bitmap.Dispose() }
$tree = @($controls | ForEach-Object { @{ name = $_.Current.Name; type = $_.Current.ControlType.ProgrammaticName; id = $_.Current.AutomationId; enabled = $_.Current.IsEnabled } })
Save-Observation 'invoking-save' $windows $controls $acceptedValue
$buttons[0].GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
@{ dialog = $record; requestedPath = $destination; acceptedFieldValue = $acceptedValue
    input = 'Native UIA ValuePattern, physical Tab, and Save InvokePattern'; controls = $tree; capture = $capture } | ConvertTo-Json -Depth 8
