param(
    [Parameter(Mandatory)][ValidateSet('Host', 'PolicyApply', 'PolicyRestore', 'Inspect', 'Observe', 'Save', 'Close', 'Cleanup', 'ExtractDriver')][string]$Action,
    [Parameter(Mandatory)][string]$Request
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:CI -cne 'true' -or $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows' -or
    $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or $env:GITHUB_REPOSITORY -cne 'rndaom/execs' -or
    $env:GITHUB_REF -notmatch '^refs/(heads|pull)/') { throw 'Disposable hosted Windows only.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($identity.User.Value -eq 'S-1-5-18') { throw 'SYSTEM is refused.' }
. (Join-Path $PSScriptRoot 'windows-package-identity.ps1')

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
    [DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", SetLastError=true)]
    static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
    public static long DialogDefaultButtonResult(IntPtr window) {
        IntPtr result;
        if (SendMessageTimeout(window, 0x0400, IntPtr.Zero, IntPtr.Zero, 0x0002, 1000, out result) == IntPtr.Zero)
            throw new Exception("Dialog default button query failed");
        return result.ToInt64();
    }
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
    if ($record.executable -ine $Expected.executable -or ($Expected.PSObject.Properties['created'] -and
        -not (Test-ProcessCreatedMatch $record.created $Expected.created))) { throw 'Process identity changed.' }
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
        if (-not (Test-ProcessCreatedMatch $record.created $expected.created) -or $record.executable -ine $expected.executable) { throw 'Cleanup process identity changed.' }
        $consolePath = [IO.Path]::GetFullPath([IO.Path]::Combine($env:WINDIR, 'System32', 'conhost.exe'))
        $parentRecord = $null
        if ($record.executable.Equals($consolePath, [StringComparison]::OrdinalIgnoreCase)) {
            $parentObserved = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$record.parent)"
            if ($parentObserved) { $parentRecord = Process-Record $parentObserved }
        }
        $ownedConsoleHost = Test-OwnedConsoleHost $record $expected $r.processes $parentRecord $r.root $env:WINDIR
        if ($record.executable.StartsWith($r.root + '\', [StringComparison]::OrdinalIgnoreCase)) {
            $null = Assert-Contained $r.root $record.executable
        } elseif ($ownedConsoleHost) {
            $null = Assert-Contained $r.root $parentRecord.executable
        } elseif ([IO.Path]::GetFileName($record.executable) -ine 'msedgewebview2.exe' -or
            -not $record.commandLine.Contains($r.userData, [StringComparison]::OrdinalIgnoreCase) -or
            $expected.parent -notin @($r.processes.pid)) { throw 'Cleanup target is outside the owned app/driver/browser tree.' }
        try {
            $process = Get-Process -Id $record.pid -ErrorAction Stop
        } catch {
            if ($_.FullyQualifiedErrorId -cne 'NoProcessFoundForGivenId,Microsoft.PowerShell.Commands.GetProcessCommand') { throw }
            $absent += $record.pid
            continue
        }
        try {
            try {
                # Keep one handle for the identity check and termination; a PID can be reused after the CIM read.
                $null = $process.SafeHandle
            } catch [InvalidOperationException] {
                if (-not $process.HasExited) { throw }
                $absent += $record.pid
                continue
            }
            if ([Math]::Abs($process.StartTime.ToUniversalTime().Ticks - (ConvertTo-ProcessUtcTicks $record.created)) -ge 10000) { throw 'Cleanup start time changed.' }
            if ($process.HasExited) { $absent += $record.pid; continue }
            try { $process.Kill() }
            catch {
                if (-not $process.HasExited) { throw }
                $absent += $record.pid
                continue
            }
            if (-not $process.WaitForExit(5000)) { throw 'Owned cleanup did not exit.' }
            $stopped += $record
        } finally { $process.Dispose() }
    }
    @{ forcedCleanup = $stopped; alreadyExited = $absent } | ConvertTo-Json -Depth 8
    exit
}

$owned = Owned-Process $r.process
$uiError = $null
$uiDiagnostics = $null
$uiLoadStage = 'UIAutomationTypes'
$wpf = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\WPF'
$uiTypesPath = Join-Path $wpf 'UIAutomationTypes.dll'
$uiClientPath = Join-Path $wpf 'UIAutomationClient.dll'
try {
    Add-Type -LiteralPath $uiTypesPath
    $uiLoadStage = 'UIAutomationClient'
    Add-Type -LiteralPath $uiClientPath
    $uiLoadStage = 'System.Windows.Forms'
    Add-Type -AssemblyName System.Windows.Forms
    $uiLoadStage = 'System.Drawing'
    Add-Type -AssemblyName System.Drawing
} catch {
    $uiError = $_.Exception.Message
    $uiDiagnostics = @{ failedStage = $uiLoadStage; exception = $_.Exception.ToString(); powerShellVersion = $PSVersionTable.PSVersion.ToString(); psHome = $PSHOME
        files = @(@($uiTypesPath, $uiClientPath) | ForEach-Object {
            $path = $_
            $file = @{ path = $path; exists = Test-Path -LiteralPath $path }
            if ($file.exists) {
                try { $file.identity = [Reflection.AssemblyName]::GetAssemblyName($path).FullName }
                catch { $file.identityError = $_.Exception.Message }
            }
            $file
        })
        loaded = @([AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { $_.GetName().Name -in @('UIAutomationTypes', 'UIAutomationClient', 'System.Windows.Forms', 'System.Drawing') } |
            ForEach-Object { @{ identity = $_.FullName; path = $_.Location } }) }
}
function Windows-ForOwner {
    $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$owned.pid)
    @([Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $condition))
}
function Window-Record($Window) {
    $current = $Window.Current
    @{ title = $current.Name; class = $current.ClassName; handle = $current.NativeWindowHandle; pid = $current.ProcessId
        nativePid = [WindowsPackageNative]::WindowPid([IntPtr]$current.NativeWindowHandle)
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
        windows = $windows; uiError = $uiError; uiDiagnostics = $uiDiagnostics; listeners = $connections
        version = (Get-Item -LiteralPath $owned.executable).VersionInfo.ProductVersion } | ConvertTo-Json -Depth 10
    exit
}
if ($uiError) { throw "Native UI Automation unavailable: $uiError" }
if ($Action -eq 'Observe') {
    $destination = Assert-Contained $r.root $r.destination $true
    $evidenceRoot = Assert-Contained $r.root (Join-Path $r.root 'evidence')
    $capture = Assert-Contained $evidenceRoot $r.capture $true
    if (Test-Path -LiteralPath $capture) { throw 'Native observation capture already exists.' }
    $windows = @(Windows-ForOwner)
    if ($windows.Count -gt 32) { throw 'Unexpected owned window count.' }
    $records = @($windows | ForEach-Object { Window-Record $_ })
    $foreground = [WindowsPackageNative]::GetForegroundWindow().ToInt64()
    $foregroundWindows = @($windows | Where-Object {
        [long]$_.Current.NativeWindowHandle -eq $foreground -and
        [int]$_.Current.ProcessId -eq $owned.pid -and
        [WindowsPackageNative]::WindowPid([IntPtr]$_.Current.NativeWindowHandle) -eq $owned.pid -and
        [WindowsPackageNative]::IsWindowVisible([IntPtr]$_.Current.NativeWindowHandle)
    })
    $captureError = $null
    $captured = $false
    if ($foregroundWindows.Count -eq 1) {
        try {
            $bounds = $foregroundWindows[0].Current.BoundingRectangle
            if ($bounds.Width -lt 1 -or $bounds.Height -lt 1 -or $bounds.Width -gt 4096 -or $bounds.Height -gt 4096) { throw 'Invalid owned foreground bounds.' }
            $bitmap = [Drawing.Bitmap]::new([int]$bounds.Width, [int]$bounds.Height)
            $graphics = [Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.CopyFromScreen([int]$bounds.Left, [int]$bounds.Top, 0, 0, $bitmap.Size)
                $bitmap.Save($capture, [Drawing.Imaging.ImageFormat]::Png)
                $captured = $true
            } finally { $graphics.Dispose(); $bitmap.Dispose() }
        } catch { $captureError = $_.Exception.Message }
    }
    $controls = @()
    $controlsError = $null
    try {
        $nativeDialogs = @($windows | Where-Object { $_.Current.ClassName -ceq '#32770' -and [WindowsPackageNative]::IsWindowVisible([IntPtr]$_.Current.NativeWindowHandle) })
        if ($nativeDialogs.Count -gt 4) { throw 'Unexpected native dialog count.' }
        foreach ($window in $nativeDialogs) {
            $controls += @($window.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition) |
                Select-Object -First 160 | ForEach-Object {
                    $name = [string]$_.Current.Name
                    $id = [string]$_.Current.AutomationId
                    @{ name = $name.Substring(0, [Math]::Min($name.Length, 256)); type = $_.Current.ControlType.ProgrammaticName
                        id = $id.Substring(0, [Math]::Min($id.Length, 128)); enabled = $_.Current.IsEnabled; offscreen = $_.Current.IsOffscreen }
                })
        }
    } catch { $controlsError = $_.Exception.Message }
    $documents = [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments)
    $candidateFiles = @(Get-ExportCandidateFiles $destination $documents $r.suggestedName)
    @{ at = [DateTime]::UtcNow.ToString('o'); process = $owned; requestedPath = $destination; foregroundHandle = $foreground
        windows = $records; nativeDialogControls = $controls; controlsError = $controlsError
        exportDialogVisible = (@($records | Where-Object { $_.title -ceq 'Export profile' -and $_.class -ceq '#32770' -and $_.visible }).Count -eq 1)
        candidateFiles = $candidateFiles; capturedOwnedForeground = $captured; capture = $(if ($captured) { $capture } else { $null }); captureError = $captureError } |
        ConvertTo-Json -Depth 8
    exit
}
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
$evidenceRoot = Assert-Contained $r.root (Join-Path $r.root 'evidence')
$observationPath = Assert-Contained $evidenceRoot $r.observation $true
function Focus-Record($Dialog, $FileType, $Filename) {
    $focused = [Windows.Automation.AutomationElement]::FocusedElement
    $inDialog = Test-FocusWithin $focused $Dialog
    $record = @{ inDialog = $inDialog; inFileType = $false; inFilename = $false }
    if ($inDialog) {
        $record.inFileType = Test-FocusWithin $focused $FileType
        $record.inFilename = Test-FocusWithin $focused $Filename
        $name = [string]$focused.Current.Name
        $id = [string]$focused.Current.AutomationId
        $record.control = @{ name = $name.Substring(0, [Math]::Min($name.Length, 256)); id = $id.Substring(0, [Math]::Min($id.Length, 128))
            type = $focused.Current.ControlType.ProgrammaticName; handle = $focused.Current.NativeWindowHandle }
    }
    return $record
}
function Save-Observation($Stage, $Windows, $Controls = @(), $FieldValue = $null, $OwnershipRoute = $null, $DefaultButtonResult = $null, $Focus = $null) {
    $observation = @{ stage = $Stage; at = [DateTime]::UtcNow.ToString('o'); requestedPath = $destination; fieldValue = $FieldValue
        ownershipRoute = $OwnershipRoute; defaultButtonResult = $DefaultButtonResult; focus = $Focus
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
$windows = @(Windows-ForOwner)
$ownershipRoute = Assert-ExportDialogIdentity $record @($windows | ForEach-Object { Window-Record $_ }) $owned.pid ([WindowsPackageNative]::GetForegroundWindow().ToInt64())
$edits = @($controls | Where-Object { $_.Current.ControlType -eq [Windows.Automation.ControlType]::Edit -and $_.Current.AutomationId -ceq '1001' -and $_.Current.Name -ceq 'File name:' })
$fileTypes = @($controls | Where-Object { $_.Current.ControlType -eq [Windows.Automation.ControlType]::ComboBox -and $_.Current.AutomationId -ceq 'FileTypeControlHost' -and $_.Current.Name -ceq 'Save as type:' })
$buttons = @($controls | Where-Object { $_.Current.ControlType -eq [Windows.Automation.ControlType]::Button -and $_.Current.AutomationId -ceq '1' -and $_.Current.Name -match '^Save$' })
if ($edits.Count -ne 1 -or $fileTypes.Count -ne 1 -or $buttons.Count -ne 1) { throw 'Native Save controls are not unambiguous.' }
if (-not (Test-SendKeysLiteralPath $destination)) { throw 'Requested path contains unsupported native keystrokes.' }
$edit = $edits[0]
$null = Owned-Process $r.process
$windows = @(Windows-ForOwner)
$ownershipRoute = Assert-ExportDialogIdentity (Window-Record $dialog) @($windows | ForEach-Object { Window-Record $_ }) $owned.pid ([WindowsPackageNative]::GetForegroundWindow().ToInt64())
$edit.SetFocus()
$value = $edit.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
if ($value.Current.IsReadOnly) { throw 'File name is read-only.' }
if (-not $edit.Current.HasKeyboardFocus) { throw 'Native filename did not receive keyboard focus.' }
[Windows.Forms.SendKeys]::SendWait('^a')
[Windows.Forms.SendKeys]::SendWait($destination)
if ($value.Current.Value -cne $destination) { throw 'Native filename did not accept the typed path.' }
[Windows.Forms.SendKeys]::SendWait('{TAB}')
$tabFocusDeadline = [DateTime]::UtcNow.AddSeconds(2)
do {
    $focusAfterTab = Focus-Record $dialog $fileTypes[0] $edit
    if ($focusAfterTab.inFileType) { break }
    if (-not $focusAfterTab.inDialog -or [DateTime]::UtcNow -gt $tabFocusDeadline) {
        Save-Observation 'filetype-focus-missing-after-tab' $windows $controls $value.Current.Value $ownershipRoute $null $focusAfterTab
        throw 'Physical Tab did not focus the native Save as type control.'
    }
    Start-Sleep -Milliseconds 50
} while ($true)
if ($value.Current.Value -cne $destination) { throw 'Native filename did not accept the requested path.' }
$acceptedValue = $value.Current.Value
$null = Owned-Process $r.process
$windows = @(Windows-ForOwner)
$ownershipRoute = Assert-ExportDialogIdentity (Window-Record $dialog) @($windows | ForEach-Object { Window-Record $_ }) $owned.pid ([WindowsPackageNative]::GetForegroundWindow().ToInt64())
$defaultAfterTab = [WindowsPackageNative]::DialogDefaultButtonResult([IntPtr]$dialog.Current.NativeWindowHandle)
Save-Observation 'filename-committed-after-tab' $windows $controls $acceptedValue $ownershipRoute $defaultAfterTab $focusAfterTab
$capture = Assert-Contained $evidenceRoot $r.capture $true
$bounds = $dialog.Current.BoundingRectangle
$bitmap = [Drawing.Bitmap]::new([int]$bounds.Width, [int]$bounds.Height)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.CopyFromScreen([int]$bounds.Left, [int]$bounds.Top, 0, 0, $bitmap.Size)
    $bitmap.Save($capture, [Drawing.Imaging.ImageFormat]::Png)
} finally { $graphics.Dispose(); $bitmap.Dispose() }
$tree = @($controls | ForEach-Object { @{ name = $_.Current.Name; type = $_.Current.ControlType.ProgrammaticName; id = $_.Current.AutomationId; enabled = $_.Current.IsEnabled } })
$null = Owned-Process $r.process
$windows = @(Windows-ForOwner)
$ownershipRoute = Assert-ExportDialogIdentity (Window-Record $dialog) @($windows | ForEach-Object { Window-Record $_ }) $owned.pid ([WindowsPackageNative]::GetForegroundWindow().ToInt64())
if (Test-Path -LiteralPath $destination) { throw 'Export destination appeared before Save.' }
$null = Assert-Contained $r.root $destination $true
if ($value.Current.Value -cne $destination) { throw 'Native filename changed before Save.' }
$focusBeforeShiftTab = Focus-Record $dialog $fileTypes[0] $edit
if (-not $focusBeforeShiftTab.inFileType) {
    Save-Observation 'filetype-focus-lost-before-shift-tab' $windows $controls $acceptedValue $ownershipRoute $defaultAfterTab $focusBeforeShiftTab
    throw 'Native Save as type control lost focus before Shift+Tab.'
}
[Windows.Forms.SendKeys]::SendWait('+{TAB}')
$focusDeadline = [DateTime]::UtcNow.AddSeconds(2)
do {
    $focusAfterShiftTab = Focus-Record $dialog $fileTypes[0] $edit
    if ($focusAfterShiftTab.inFilename) { break }
    if (-not $focusAfterShiftTab.inDialog -or [DateTime]::UtcNow -gt $focusDeadline) {
        Save-Observation 'filename-focus-missing-after-shift-tab' $windows $controls $acceptedValue $ownershipRoute $defaultAfterTab $focusAfterShiftTab
        throw 'Physical Shift+Tab did not return focus to the native filename.'
    }
    Start-Sleep -Milliseconds 50
} while ($true)
$null = Owned-Process $r.process
$windows = @(Windows-ForOwner)
$ownershipRoute = Assert-ExportDialogIdentity (Window-Record $dialog) @($windows | ForEach-Object { Window-Record $_ }) $owned.pid ([WindowsPackageNative]::GetForegroundWindow().ToInt64())
$defaultButtonResult = [WindowsPackageNative]::DialogDefaultButtonResult([IntPtr]$dialog.Current.NativeWindowHandle)
Save-Observation 'filename-focused-after-shift-tab' $windows $controls $value.Current.Value $ownershipRoute $defaultButtonResult $focusAfterShiftTab
$null = Owned-Process $r.process
$windows = @(Windows-ForOwner)
$ownershipRoute = Assert-ExportDialogIdentity (Window-Record $dialog) @($windows | ForEach-Object { Window-Record $_ }) $owned.pid ([WindowsPackageNative]::GetForegroundWindow().ToInt64())
if (Test-Path -LiteralPath $destination) { throw 'Export destination appeared before Enter.' }
$null = Assert-Contained $r.root $destination $true
$defaultButtonResult = [WindowsPackageNative]::DialogDefaultButtonResult([IntPtr]$dialog.Current.NativeWindowHandle)
$focusBeforeEnter = Focus-Record $dialog $fileTypes[0] $edit
$filenameFocused = $focusBeforeEnter.inFilename
$saveEnabled = $buttons[0].Current.IsEnabled
$saveVisible = -not $buttons[0].Current.IsOffscreen
if (-not (Test-SaveEnterReadiness $value.Current.Value $destination $filenameFocused $saveEnabled $saveVisible $defaultButtonResult)) {
    Save-Observation 'enter-readiness-refused' $windows $controls $value.Current.Value $ownershipRoute $defaultButtonResult $focusBeforeEnter
    throw "Native filename or default Save button is not ready for Enter ($defaultButtonResult)."
}
[Windows.Forms.SendKeys]::SendWait('{ENTER}')
@{ dialog = $record; ownershipRoute = $ownershipRoute; requestedPath = $destination; acceptedFieldValue = $acceptedValue
    defaultButtonResult = $defaultButtonResult; focusBeforeEnter = $focusBeforeEnter
    input = 'Physical filename keystrokes, Tab, Shift+Tab to filename, Enter with default Save'; controls = $tree; capture = $capture } | ConvertTo-Json -Depth 8
