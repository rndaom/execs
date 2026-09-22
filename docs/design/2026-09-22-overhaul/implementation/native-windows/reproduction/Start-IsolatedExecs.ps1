# Local QA launcher. This file prepares disposable data only; run it explicitly to launch.
# The Desktop stage uses the existing Explorer desktop to escape packaged-host inheritance.
[CmdletBinding()]
param(
    [ValidateSet('StartupError', 'Rootless', 'InactiveLibrary')]
    [string]$Scenario = 'StartupError',
    [string]$Executable = 'G:\Projects\execs\apps\desktop\src-tauri\target\release\execs.exe',
    [string]$HostExecutable = 'C:\Users\Random\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe',
    [string]$CaseDirectory,
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
        if ($Resume -and $request.scenario -ne 'Rootless') { throw 'Only a Rootless case can be resumed.' }
        if ($LaunchPrepared -and (Test-Path -LiteralPath (Join-Path $casePath 'launch.json'))) { throw 'This prepared case was already launched. Inactive-library cases cannot be replayed.' }
        if ($request.executable -ne $exe -or $request.executableSha256 -ne (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash) {
            throw 'Resume requires the same exact binary. Start a new case for a new build.'
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
        if ($Scenario -eq 'StartupError') {
            $maintenance = Join-Path $casePath 'roaming\execs\maintenance'
            [IO.Directory]::CreateDirectory($maintenance) | Out-Null
            $marker = Join-Path $maintenance 'steam-verification'
            [IO.File]::WriteAllText($marker, "not-a-valid-lease`n", $utf8)
            $markerHash = (Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash
        }
        $inactiveFixture = $null
        if ($Scenario -eq 'InactiveLibrary') {
            . (Join-Path $PSScriptRoot 'InactiveLibraryFixture.ps1')
            $inactiveFixture = Initialize-InactiveLibraryFixture $casePath
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
            inactiveFixture = $inactiveFixture
            preparedUtc = [DateTime]::UtcNow.ToString('o')
        }
        Write-Json (Join-Path $casePath 'request.json') $request
    }

    if ($PrepareOnly) {
        Write-Output "Prepared only; nothing launched. Case: $casePath"
        Write-Output 'Review request.json, inactive-library-sources.json and inactive-library-baseline.json before explicitly using LaunchPrepared.'
        return
    }
    if ($request.scenario -eq 'InactiveLibrary' -and -not $LaunchPrepared) {
        Write-Output "Inactive library prepared only. Case: $casePath"
        Write-Output 'This scenario requires a separate explicit LaunchPrepared invocation after review.'
        return
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
    & '@@SCRIPT@@' -Child -CaseDirectory $bootstrapCase
} catch {
    $failure = [ordered]@{ message = $_.Exception.Message; errorId = $_.FullyQualifiedErrorId; pid = $PID; utc = [DateTime]::UtcNow.ToString('o') }
    [IO.File]::WriteAllText((Join-Path $bootstrapCase 'bootstrap-failure.json'), (ConvertTo-Json -InputObject $failure), $bootstrapEncoding)
    exit 1
}
'@
    $childCommand = $childCommand.Replace('@@SCRIPT@@', $selfQuoted).Replace('@@CASE@@', $caseQuoted)
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
    if ($request.scenario -eq 'InactiveLibrary') {
        Write-Output 'Scope: Import the copied fixture ZIP, inspect review, Cancel; use Actions to delete one inactive fixture profile. Never click a profile name/Switch, confirm import, Save current, New profile, Launch TF2 or Install update.'
    } else {
        Write-Output 'Scope: startup-error copy/dismiss, or rootless App settings, close/reopen and install-picker Cancel. Do not Confirm an install, select/create/import a profile, launch TF2 or install an update.'
    }
    return
}

$casePath = Assert-CasePath $CaseDirectory
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
    if ($request.scenario -eq 'InactiveLibrary') {
        . (Join-Path $PSScriptRoot 'InactiveLibraryFixture.ps1')
        Assert-InactiveLibraryFixture $casePath
    } elseif ($request.scenario -in @('StartupError', 'Rootless')) {
        if ($settings.tf2Root -ne '') { throw 'Rootless scope requires an empty confirmed TF2 root.' }
    } else { throw 'Unknown QA scenario.' }
    if (Test-Path -LiteralPath (Join-Path $casePath 'work\tf\steam.inf')) { throw 'Working directory unexpectedly resembles a TF2 install.' }
    if ($request.scenario -eq 'StartupError') {
        $marker = Join-Path $casePath 'roaming\execs\maintenance\steam-verification'
        if ((Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash -ne $request.markerSha256) { throw 'Startup-error marker changed.' }
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
    Assert-NoExecs
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
        appData = $env:APPDATA
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
    [IO.File]::WriteAllText((Join-Path $casePath 'stdout.txt'), $stdout.GetAwaiter().GetResult(), $utf8)
    [IO.File]::WriteAllText((Join-Path $casePath 'stderr.txt'), $stderr.GetAwaiter().GetResult(), $utf8)
    $afterMarkerHash = $null
    if ($request.scenario -eq 'StartupError' -and (Test-Path -LiteralPath $marker)) {
        $afterMarkerHash = (Get-FileHash -LiteralPath $marker -Algorithm SHA256).Hash
    }
    Write-Json (Join-Path $casePath 'exit.json') ([ordered]@{
        appPid = $app.Id
        exitCode = $app.ExitCode
        exitedUtc = [DateTime]::UtcNow.ToString('o')
        markerSha256Before = $request.markerSha256
        markerSha256After = $afterMarkerHash
        defaultTauriLocalDataExistsAfter = (Test-Path -LiteralPath $defaultWebviewDir)
    })
} catch {
    Write-Json (Join-Path $casePath 'failure.json') ([ordered]@{
        message = $_.Exception.Message
        helperPid = $PID
        utc = [DateTime]::UtcNow.ToString('o')
    })
    throw
}
