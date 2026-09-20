$ErrorActionPreference = 'Stop'
if ($env:CI -ne 'true') { throw 'Requires a disposable CI worker' }
$qualification = Join-Path (Get-Location) 'files-qualification-windows'
New-Item -ItemType Directory -Path $qualification | Out-Null
$bundle = Join-Path $qualification 'bundle'
pnpm --filter '@execs/desktop' exec vite build --config ../../scripts/qualification/files/vite.config.mts --outDir $bundle
if ($LASTEXITCODE -ne 0) { throw 'Production fixture build failed' }
$server = Start-Process node -ArgumentList @('scripts/qualification/files/serve.mjs', $bundle) -WindowStyle Hidden -PassThru -RedirectStandardOutput "$qualification/server.log" -RedirectStandardError "$qualification/server-error.log"
$nvdaProcess = $null
try {
    $download = Join-Path $qualification 'nvda_2026.2.exe'
    Invoke-WebRequest 'https://download.nvaccess.org/releases/2026.2/nvda_2026.2.exe' -OutFile $download
    if ((Get-FileHash $download -Algorithm SHA256).Hash -ne 'F3F8D29974A88D687B3C4809BE192219EC579C5BDABCDA5AAF53635288BCA824') { throw 'NVDA pinned hash mismatch' }
    $signature = Get-AuthenticodeSignature $download
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'NV Access') { throw 'NVDA signature invalid' }
    $portable = Join-Path $qualification 'nvda'
    $extract = Start-Process $download -ArgumentList @('--create-portable-silent', "--portable-path=$portable", '--minimal') -WindowStyle Hidden -PassThru
    if (-not $extract.WaitForExit(120000) -or $extract.ExitCode -ne 0) { throw 'NVDA portable extraction failed' }
    $nvdaConfig = Join-Path $qualification 'nvda-config'
    New-Item -ItemType Directory -Path $nvdaConfig | Out-Null
    @'
[general]
showWelcomeDialogAtStartup = False
saveConfigurationOnExit = False
askToExit = False
[speech]
synth = espeak
[update]
autoCheck = False
startupNotification = False
allowUsageStats = False
askedAllowUsageStats = True
'@ | Set-Content -LiteralPath "$nvdaConfig/nvda.ini"
    $nvdaProcess = Start-Process "$portable/nvda.exe" -ArgumentList @('--minimal', '--no-sr-flag', '--disable-addons', '--log-level=12', "--log-file=$qualification/nvda.log", "--config-path=$nvdaConfig") -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 8
    $hostRun = Start-Process './host/FilesQualification.exe' -ArgumentList @('http://127.0.0.1:8765/?preview=settings-files', "$qualification/1200x800", '1200', '800', '1', 'automate') -WindowStyle Hidden -PassThru
    if (-not $hostRun.WaitForExit(180000)) { $hostRun.Kill(); throw 'Native qualification timed out' }
    if ($hostRun.ExitCode -ne 0) { throw 'Native qualification failed; inspect host evidence' }
    foreach ($layout in @(@('960x640', '960', '640', '1'), @('1280x800', '1280', '800', '1'), @('1200x800-200pct', '1200', '800', '2'))) {
        $layoutRun = Start-Process './host/FilesQualification.exe' -ArgumentList @('http://127.0.0.1:8765/?preview=settings-files', "$qualification/$($layout[0])", $layout[1], $layout[2], $layout[3], 'capture') -WindowStyle Hidden -PassThru
        if (-not $layoutRun.WaitForExit(60000)) { $layoutRun.Kill(); throw 'Layout capture timed out' }
        if ($layoutRun.ExitCode -ne 0) { throw 'Layout capture failed' }
    }
    Start-Sleep -Seconds 2
    $speech = Select-String -Path "$qualification/nvda.log" -Pattern 'Speaking.*(Contents of|sensitivity)' | ForEach-Object { $_.Line }
    $speech | Set-Content "$qualification/speech-selected.txt"
    if (-not ($speech -match 'Contents of')) { throw 'No actual NVDA editor-name speech found' }
    Get-CimInstance Win32_Processor | Select-Object Name | ConvertTo-Json | Set-Content "$qualification/cpu.json"
    Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber | ConvertTo-Json | Set-Content "$qualification/os.json"
    git rev-parse HEAD | Set-Content "$qualification/commit.txt"
} finally {
    if ($nvdaProcess -and -not $nvdaProcess.HasExited) { $nvdaProcess.Kill() }
    if (-not $server.HasExited) { $server.Kill() }
}
