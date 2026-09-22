# Local QA launcher. This file prepares disposable data only; run it explicitly to launch.
# The Desktop stage uses the existing Explorer desktop to escape packaged-host inheritance.
[CmdletBinding()]
param(
    [ValidateSet('StartupError', 'Rootless', 'InactiveLibrary', 'InactiveImport')]
    [string]$Scenario = 'StartupError',
    [string]$Executable = 'G:\Projects\execs\apps\desktop\src-tauri\target\release\execs.exe',
    [string]$HostExecutable = 'C:\Users\Random\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe',
    [string]$CaseDirectory,
    [ValidateSet('InvalidMarker', 'UnsetAppData', 'MismatchedToken', 'MultipleMarkers', 'UnreadableMarker')]
    [string]$StartupVariant = 'InvalidMarker',
    [switch]$Resume,
    [switch]$PrepareOnly,
    [switch]$LaunchPrepared,
    [switch]$Child
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$utf8 = New-Object System.Text.UTF8Encoding($false)
$qaRoot = 'G:\Projects\execs\.artifacts\native-isolation'

function Write-Json([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, (ConvertTo-Json -InputObject $Value -Depth 8), $utf8)
}

function Assert-CasePath([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $prefix = [IO.Path]::GetFullPath($qaRoot).TrimEnd('\') + '\'
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Case directory must be beneath $qaRoot"
    }
    $walk = $full
    while ($walk) {
        if (Test-Path -LiteralPath $walk) {
            $item = Get-Item -LiteralPath $walk -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Refusing a linked/reparse-point path: $walk"
            }
        }
        $parent = [IO.Directory]::GetParent($walk)
        if ($null -eq $parent) { break }
        $walk = $parent.FullName
    }
    return $full
}

function Assert-NoExecs {
    $existing = @(Get-CimInstance Win32_Process -Filter "Name='execs.exe'")
    if ($existing.Count -gt 0) {
        throw "An execs.exe process already exists. Close it normally before this isolated launch. PIDs: $($existing.ProcessId -join ', ')"
    }
}

if (-not $Child) {
    if ($Resume -and $LaunchPrepared) { throw 'Choose Resume or LaunchPrepared, not both.' }
    if (-not $PrepareOnly) { Assert-NoExecs }
    $exe = (Get-Item -LiteralPath $Executable).FullName
    $hostExe = (Get-Item -LiteralPath $HostExecutable).FullName
    if ([IO.Path]::GetFileName($exe) -ne 'execs.exe') { throw 'Expected execs.exe.' }
    if ([IO.Path]::GetFileName($hostExe) -notin @('pwsh.exe', 'powershell.exe')) { throw 'Expected a PowerShell host executable.' }
    if ($Resume -or $LaunchPrepared) {
        if (-not $CaseDirectory) { throw 'Resume/LaunchPrepared requires CaseDirectory.' }
        $casePath = Assert-CasePath $CaseDirectory
        $request = Get-Content -LiteralPath (Join-Path $casePath 'request.json') -Raw | ConvertFrom-Json
        if ($Resume -and $request.scenario -notin @('Rootless','InactiveImport')) { throw 'Only Rootless or validated InactiveImport cases can be resumed.' }
        if ($LaunchPrepared -and (Test-Path -LiteralPath (Join-Path $casePath 'launch.json'))) { throw 'This prepared case was already launched. Inactive-library cases cannot be replayed.' }
        if ($request.executable -ne $exe -or $request.executableSha256 -ne (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash) {
            throw 'Resume requires the same exact binary. Start a new case for a new build.'
        }
        if ($request.scenario -eq 'InactiveImport') {
            . (Join-Path $PSScriptRoot 'InactiveImportFixture.ps1')
            if ($Resume) { $reopenAudit = Assert-InactiveImportReopen $casePath }
            else { $null = Get-InactiveImportAudit $casePath 'Initial' }
        }
    } else {
        if (-not $CaseDirectory) {
            $CaseDirectory = Join-Path $qaRoot ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $Scenario.ToLowerInvariant() + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
        }
        $casePath = Assert-CasePath $CaseDirectory
        if (Test-Path -LiteralPath $casePath) { throw 'New cases require a fresh directory. Use -Resume for Rootless persistence checks.' }
        foreach ($relative in @('', 'roaming', 'roaming\execs', 'local', 'temp', 'xdg-data', 'xdg-config', 'xdg-cache', 'webview2', 'work')) {
            [IO.Directory]::CreateDirectory((Join-Path $casePath $relative)) | Out-Null
        }
        [IO.File]::WriteAllText((Join-Path $casePath 'roaming\execs\settings.json'), '{"schema":1,"tf2Root":"","preferences":{"checkForUpdatesOnStartup":false,"motion":"system"}}', $utf8)
        $markerHash = $null
        $startupMarkers = @()
        if ($Scenario -eq 'StartupError') {
            $markerSpecs = @(switch ($StartupVariant) {
                'InvalidMarker' { @{ Name='steam-verification'; Text="not-a-valid-lease`n" } }
                'UnsetAppData' { }
                'MismatchedToken' { @{ Name='launching-tf2'; Text="1026`n" } }
                'MultipleMarkers' {
                    @{ Name='launching-tf2'; Text="1281`n" }
                    @{ Name='steam-verification'; Text="1538`n" }
                }
                'UnreadableMarker' { @{ Name='launching-tf2'; Text="1281`n" } }
            })
            $originals = Join-Path $casePath 'fixture-originals'
            [IO.Directory]::CreateDirectory($originals) | Out-Null
            Copy-Item -LiteralPath (Join-Path $casePath 'roaming\execs\settings.json') -Destination (Join-Path $originals 'settings.json')
            foreach ($spec in @($markerSpecs)) {
                $maintenance = Join-Path $casePath 'roaming\execs\maintenance'
                [IO.Directory]::CreateDirectory($maintenance) | Out-Null
                $marker = Join-Path $maintenance $spec.Name
                $original = Join-Path $originals $spec.Name
                [IO.File]::WriteAllText($marker, $spec.Text, $utf8)
                Copy-Item -LiteralPath $marker -Destination $original
                $startupMarkers += [ordered]@{ name=$spec.Name; sha256=(Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash; bytes=(Get-Item -LiteralPath $marker).Length }
            }
            if ($startupMarkers.Count -gt 0) { $markerHash = $startupMarkers[0].sha256 }
        }
        $inactiveFixture = $null
        $inactiveImport = $null
        if ($Scenario -in @('InactiveLibrary','InactiveImport')) {
            . (Join-Path $PSScriptRoot 'InactiveLibraryFixture.ps1')
            $inactiveFixture = Initialize-InactiveLibraryFixture $casePath
            if ($Scenario -eq 'InactiveImport') {
                . (Join-Path $PSScriptRoot 'InactiveImportFixture.ps1')
                $inactiveImport = Initialize-InactiveImportPlan $casePath
            }
        }
        $request = [ordered]@{
            scenario = $Scenario
            executable = $exe
            executableSha256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
            executableLength = (Get-Item -LiteralPath $exe).Length
            executableModifiedUtc = (Get-Item -LiteralPath $exe).LastWriteTimeUtc.ToString('o')
            executableProductVersion = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
            helperExecutable = $hostExe
            helperExecutableSha256 = (Get-FileHash -LiteralPath $hostExe -Algorithm SHA256).Hash
            markerSha256 = $markerHash
            startupVariant = $(if ($Scenario -eq 'StartupError') { $StartupVariant } else { $null })
            startupMarkers = $startupMarkers
            inactiveFixture = $inactiveFixture
            inactiveImport = $inactiveImport
            preparedUtc = [DateTime]::UtcNow.ToString('o')
        }
        Write-Json (Join-Path $casePath 'request.json') $request
        if ($Scenario -eq 'InactiveImport') { $null = Get-InactiveImportAudit $casePath 'Initial' }
    }

    if ($PrepareOnly) {
        Write-Output "Prepared only; nothing launched. Case: $casePath"
        if ($request.scenario -eq 'StartupError') {
            Write-Output 'Review request.json and fixture-originals before explicitly using LaunchPrepared. A startup-error case must not open the main app.'
        } else {
            Write-Output 'Review request.json and applicable fixture baselines before explicitly using LaunchPrepared.'
        }
        return
    }
    if ($request.scenario -in @('InactiveLibrary','InactiveImport') -and -not $LaunchPrepared -and -not $Resume) {
        Write-Output "Inactive library prepared only. Case: $casePath"
        Write-Output 'This scenario requires a separate explicit LaunchPrepared invocation after review.'
        return
    }

    if ($Resume -and $request.scenario -eq 'InactiveImport') {
        $sessionDirectory = Join-Path $casePath 'import-export-session'
        if (Test-Path -LiteralPath $sessionDirectory) { throw 'The bounded inactive import case permits one reopen only.' }
        [IO.Directory]::CreateDirectory($sessionDirectory) | Out-Null
        foreach ($name in @('request.json','bootstrap.json','launch.json','exit.json','webview-processes.json','stdout.txt','stderr.txt','post-import-export-integrity.json')) {
            Copy-Item -LiteralPath (Join-Path $casePath $name) -Destination (Join-Path $sessionDirectory $name)
        }
        Write-Json (Join-Path $casePath 'pre-reopen-integrity.json') $reopenAudit
    }

    # Encoded PowerShell avoids shell metacharacters in file paths. No cmd.exe is involved.
    $selfQuoted = $PSCommandPath.Replace("'", "''")
    $caseQuoted = $casePath.Replace("'", "''")
    # This outer command is deliberately separate from file invocation: an
    # execution-policy refusal can happen before the script's own try/catch.
    # Record it without altering any execution policy or retrying the app.
    $childCommand = @'
$ErrorActionPreference = 'Stop'
$bootstrapCase = '@@CASE@@'
$bootstrapEncoding = New-Object Text.UTF8Encoding($false)
try {
    $bootstrap = [ordered]@{
        pid = $PID
        version = $PSVersionTable.PSVersion.ToString()
        executable = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
        effectiveExecutionPolicy = (Get-ExecutionPolicy).ToString()
        executionPolicies = @(Get-ExecutionPolicy -List | ForEach-Object { [ordered]@{ scope = $_.Scope.ToString(); policy = $_.ExecutionPolicy.ToString() } })
        startedUtc = [DateTime]::UtcNow.ToString('o')
    }
    [IO.File]::WriteAllText((Join-Path $bootstrapCase 'bootstrap.json'), (ConvertTo-Json -InputObject $bootstrap -Depth 6), $bootstrapEncoding)
    & '@@SCRIPT@@' -Child -CaseDirectory $bootstrapCase @@RESUME@@
} catch {
    $failure = [ordered]@{ message = $_.Exception.Message; errorId = $_.FullyQualifiedErrorId; pid = $PID; utc = [DateTime]::UtcNow.ToString('o') }
    [IO.File]::WriteAllText((Join-Path $bootstrapCase 'bootstrap-failure.json'), (ConvertTo-Json -InputObject $failure), $bootstrapEncoding)
    exit 1
}
'@
    $childCommand = $childCommand.Replace('@@SCRIPT@@', $selfQuoted).Replace('@@CASE@@', $caseQuoted).Replace('@@RESUME@@', $(if ($Resume) { '-Resume' } else { '' }))
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childCommand))
    $desktopHandle = 0
    $shell = New-Object -ComObject Shell.Application
    $desktop = $shell.Windows().FindWindowSW(0, $null, 8, [ref]$desktopHandle, 1)
    if ($null -eq $desktop) { throw 'Could not obtain the existing Explorer desktop dispatch.' }
    $desktop.Document.Application.ShellExecute(
        $hostExe,
        "-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand $encoded",
        $casePath,
        'open',
        0
    )
    Write-Output "Explorer launch requested. Case: $casePath"
    Write-Output "Read launch.json (or failure.json) before interacting. The helper writes exit.json when execs closes."
    if ($request.scenario -eq 'StartupError') {
        Write-Output 'Scope: inspect the native startup error, copy its full diagnostic, and dismiss with OK. Expect no main window, console or WebView2. Do not terminate the helper holding an unreadable marker; close this execs process normally first.'
    } elseif ($request.scenario -eq 'InactiveImport') {
        Write-Output 'Scope: Import the copied multi-HUD ZIP, explicitly choose secondhud and confirm; export only the new inactive profile to the planned private ZIP; close normally. On the one validated reopen, inspect persisted profiles and close. Never activate, repair HUD ownership, change settings/install, launch TF2 or install an update.'
    } elseif ($request.scenario -eq 'InactiveLibrary') {
        Write-Output 'Scope: Import the copied fixture ZIP, inspect review, Cancel; use Actions to delete one inactive fixture profile. Never click a profile name/Switch, confirm import, Save current, New profile, Launch TF2 or Install update.'
    } else {
        Write-Output 'Scope: startup-error copy/dismiss, or rootless App settings, close/reopen and install-picker Cancel. Do not Confirm an install, select/create/import a profile, launch TF2 or install an update.'
    }
    return
}

$casePath = Assert-CasePath $CaseDirectory
$heldStartupMarker = $null
$app = $null
try {
    # Compiler scratch files and all child runtime files stay in this private case.
    $env:TEMP = Join-Path $casePath 'temp'
    $env:TMP = $env:TEMP
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class ExecsQaPackage {
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)] static extern int GetPackageFullName(IntPtr process, ref uint length, StringBuilder name);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public static int Status(int pid) {
        IntPtr handle = OpenProcess(0x1000, false, (uint)pid);
        if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try { uint length = 0; return GetPackageFullName(handle, ref length, null); }
        finally { CloseHandle(handle); }
    }
}
'@
    $helperCode = [ExecsQaPackage]::Status($PID)
    if ($helperCode -ne 15700) { throw "Helper has a package identity or could not be verified: GetPackageFullName=$helperCode. App was not launched." }
    $helperProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$PID"
    $parentId = [int]$helperProcess.ParentProcessId
    $parentProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$parentId"
    $parentCode = [ExecsQaPackage]::Status($parentId)
    if ($parentCode -ne 15700) { throw "Launcher parent has a package identity or could not be verified: GetPackageFullName=$parentCode. App was not launched." }
    Assert-NoExecs
    $request = Get-Content -LiteralPath (Join-Path $casePath 'request.json') -Raw | ConvertFrom-Json
    $exe = (Get-Item -LiteralPath $request.executable).FullName
    if ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -ne $request.executableSha256) { throw 'Binary changed after preparation.' }
    $settings = Get-Content -LiteralPath (Join-Path $casePath 'roaming\execs\settings.json') -Raw | ConvertFrom-Json
    if ($request.scenario -eq 'InactiveImport') {
        . (Join-Path $PSScriptRoot 'InactiveImportFixture.ps1')
        if ($Resume) { $null = Assert-InactiveImportReopen $casePath }
        else { $null = Get-InactiveImportAudit $casePath 'Initial' }
    } elseif ($request.scenario -eq 'InactiveLibrary') {
        . (Join-Path $PSScriptRoot 'InactiveLibraryFixture.ps1')
        Assert-InactiveLibraryFixture $casePath
    } elseif ($request.scenario -in @('StartupError', 'Rootless')) {
        if ($settings.tf2Root -ne '') { throw 'Rootless scope requires an empty confirmed TF2 root.' }
    } else { throw 'Unknown QA scenario.' }
    if (Test-Path -LiteralPath (Join-Path $casePath 'work\tf\steam.inf')) { throw 'Working directory unexpectedly resembles a TF2 install.' }
    $startupVariant = 'InvalidMarker'
    $startupMarkers = @()
    if ($request.scenario -eq 'StartupError') {
        if ($request.PSObject.Properties.Name -contains 'startupVariant') {
            $startupVariant = [string]$request.startupVariant
            if ($startupVariant -notin @('InvalidMarker','UnsetAppData','MismatchedToken','MultipleMarkers','UnreadableMarker')) { throw 'Unknown startup failure variant.' }
            $startupMarkers = @($request.startupMarkers)
        } else {
            # Previously executed corrupt-marker cases remain readable.
            $startupMarkers = @([pscustomobject]@{ name='steam-verification'; sha256=$request.markerSha256 })
        }
        foreach ($recordedMarker in $startupMarkers) {
            if ($recordedMarker.name -notin @('launching-tf2','steam-verification')) { throw 'Unexpected private marker name.' }
            $marker = Assert-CasePath (Join-Path $casePath ("roaming\execs\maintenance\" + $recordedMarker.name))
            if ((Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash -ne $recordedMarker.sha256) { throw 'Startup-error marker changed.' }
            $original = Join-Path $casePath ("fixture-originals\" + $recordedMarker.name)
            if (Test-Path -LiteralPath $original) {
                $null = Assert-CasePath $original
                if ((Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash -ne $recordedMarker.sha256) { throw 'Original startup marker copy changed.' }
            }
        }
        if ($startupVariant -eq 'UnreadableMarker' -and ($startupMarkers.Count -ne 1 -or $startupMarkers[0].name -ne 'launching-tf2')) { throw 'Read-denial case requires its single launching-tf2 fixture marker.' }
    }

    # Tauri resolves this via Windows KnownFolder, not LOCALAPPDATA. It may create
    # the empty default directory, but WebView2 is explicitly redirected below.
    $defaultWebviewDir = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'com.rndaom.execs'
    $defaultWebviewExisted = Test-Path -LiteralPath $defaultWebviewDir
    $env:APPDATA = Join-Path $casePath 'roaming'
    $env:LOCALAPPDATA = Join-Path $casePath 'local'
    $env:XDG_DATA_HOME = Join-Path $casePath 'xdg-data'
    $env:XDG_CONFIG_HOME = Join-Path $casePath 'xdg-config'
    $env:XDG_CACHE_HOME = Join-Path $casePath 'xdg-cache'
    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $casePath 'webview2'

    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $exe
    $start.WorkingDirectory = Join-Path $casePath 'work'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    if ($request.scenario -eq 'StartupError' -and $startupVariant -eq 'UnsetAppData') {
        # Only execs lacks APPDATA; the helper keeps its private app-data path.
        $null = $start.Environment.Remove('APPDATA')
        if ($start.Environment.ContainsKey('APPDATA')) { throw 'Could not remove APPDATA from the execs child environment.' }
    }
    Assert-NoExecs
    if ($request.scenario -eq 'InactiveImport') {
        if ($Resume) { $null = Assert-InactiveImportReopen $casePath }
        else { $null = Get-InactiveImportAudit $casePath 'Initial' }
    }
    if ($request.scenario -eq 'StartupError' -and $startupVariant -eq 'UnreadableMarker') {
        $marker = Join-Path $casePath 'roaming\execs\maintenance\launching-tf2'
        $heldStartupMarker = [IO.File]::Open($marker, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
        Write-Json (Join-Path $casePath 'startup-marker-lock.json') ([ordered]@{ helperPid=$PID; path=$marker; sha256=$startupMarkers[0].sha256; heldUntil='execs exits'; acquiredUtc=[DateTime]::UtcNow.ToString('o') })
    }
    $app = [Diagnostics.Process]::Start($start)
    $stdout = $app.StandardOutput.ReadToEndAsync()
    $stderr = $app.StandardError.ReadToEndAsync()
    $appCode = [ExecsQaPackage]::Status($app.Id)
    $record = [ordered]@{
        scenario = $request.scenario
        helperPid = $PID
        helperPackageCode = $helperCode
        helperParentPid = $parentId
        helperParentName = $parentProcess.Name
        helperParentPackageCode = $parentCode
        appPid = $app.Id
        appPackageCode = $appCode
        executable = $exe
        executableSha256 = $request.executableSha256
        appData = $(if ($start.Environment.ContainsKey('APPDATA')) { $start.Environment['APPDATA'] } else { $null })
        appDataEnvironmentPresent = $start.Environment.ContainsKey('APPDATA')
        startupVariant = $(if ($request.scenario -eq 'StartupError') { $startupVariant } else { $null })
        localAppData = $env:LOCALAPPDATA
        webviewUserDataFolder = $env:WEBVIEW2_USER_DATA_FOLDER
        workingDirectory = $start.WorkingDirectory
        defaultTauriLocalData = $defaultWebviewDir
        defaultTauriLocalDataExistedBefore = $defaultWebviewExisted
        launchedUtc = [DateTime]::UtcNow.ToString('o')
    }
    Write-Json (Join-Path $casePath 'launch.json') $record
    if ($appCode -ne 15700) { throw "App identity check failed: GetPackageFullName=$appCode. Stop QA and close only this recorded process normally." }
    # Capture process command lines as evidence of WebView2's actual data folder.
    Start-Sleep -Seconds 3
    $webviews = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object {
        $_.ParentProcessId -eq $app.Id -or ($_.CommandLine -and $_.CommandLine.Contains($casePath))
    } | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine)
    Write-Json (Join-Path $casePath 'webview-processes.json') $webviews
    $app.WaitForExit()
    if ($null -ne $heldStartupMarker) {
        $heldStartupMarker.Dispose()
        $heldStartupMarker = $null
        Write-Json (Join-Path $casePath 'startup-marker-lock-released.json') ([ordered]@{ helperPid=$PID; appPid=$app.Id; releasedAfterAppExit=$true; releasedUtc=[DateTime]::UtcNow.ToString('o') })
    }
    [IO.File]::WriteAllText((Join-Path $casePath 'stdout.txt'), $stdout.GetAwaiter().GetResult(), $utf8)
    [IO.File]::WriteAllText((Join-Path $casePath 'stderr.txt'), $stderr.GetAwaiter().GetResult(), $utf8)
    $afterMarkerHash = $null
    $afterMarkers = @()
    if ($request.scenario -eq 'StartupError') {
        foreach ($recordedMarker in $startupMarkers) {
            $marker = Join-Path $casePath ("roaming\execs\maintenance\" + $recordedMarker.name)
            $afterMarkers += [ordered]@{ name=$recordedMarker.name; sha256=$(if (Test-Path -LiteralPath $marker) { (Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash } else { $null }) }
        }
        if ($afterMarkers.Count -gt 0) { $afterMarkerHash = $afterMarkers[0].sha256 }
    }
    Write-Json (Join-Path $casePath 'exit.json') ([ordered]@{
        appPid = $app.Id
        exitCode = $app.ExitCode
        exitedUtc = [DateTime]::UtcNow.ToString('o')
        markerSha256Before = $request.markerSha256
        markerSha256After = $afterMarkerHash
        startupMarkersAfter = $afterMarkers
        defaultTauriLocalDataExistsAfter = (Test-Path -LiteralPath $defaultWebviewDir)
    })
} catch {
    Write-Json (Join-Path $casePath 'failure.json') ([ordered]@{
        message = $_.Exception.Message
        helperPid = $PID
        utc = [DateTime]::UtcNow.ToString('o')
    })
    throw
} finally {
    if ($null -ne $heldStartupMarker) {
        # On an unexpected helper error after launch, keep denial in place
        # until the operator closes this recorded execs process normally.
        if ($null -ne $app -and -not $app.HasExited) { $app.WaitForExit() }
        $heldStartupMarker.Dispose()
        Write-Json (Join-Path $casePath 'startup-marker-lock-released.json') ([ordered]@{ helperPid=$PID; releasedAfterAppExit=($null -eq $app -or $app.HasExited); releasedUtc=[DateTime]::UtcNow.ToString('o'); cleanupAfterHelperError=$true })
    }
}
