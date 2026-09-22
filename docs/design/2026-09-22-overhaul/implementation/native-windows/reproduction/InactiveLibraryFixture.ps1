# Preparation/validation only. No process launch, registry edits or Steam lookup.
# Dot-sourced by Start-IsolatedExecs.ps1 only for the explicit InactiveLibrary case.
$fixtureExports = 'G:\Projects\execs\docs\design\2026-09-22-overhaul\implementation\profile-management\compatibility-v018'
$fixtureArchiveSpecs = @(
    @{ Folder='no-hud'; Name='QA inactive - no HUD'; Hash='3299CF62CB18DA34785C309803ED2D8ABAD427EAB9B95918EA72B1BF9259AC38' },
    @{ Folder='single-hud'; Name='QA inactive - single HUD'; Hash='4B46FB3144B5C9FCD334505672FC8513FA3F9D629F821FBB4AB53B9DA4667EC9' }
)
$fixtureReviewHash = '77CC3C6F9DED610E56084F1EF7DDD410DEFE6F04162303054A0CEE274D234727'

function Write-FixtureJson([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, (ConvertTo-Json -InputObject $Value -Depth 40), [Text.UTF8Encoding]::new($false))
}

function Write-FixtureBytes([string]$Root, [string]$Relative, [byte[]]$Bytes) {
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $target = [IO.Path]::GetFullPath((Join-Path $Root $Relative))
    if (-not $target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture path escaped its root.' }
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
    if (Test-Path -LiteralPath $target) {
        if ([Convert]::ToBase64String([IO.File]::ReadAllBytes($target)) -ne [Convert]::ToBase64String($Bytes)) { throw "Fixture collision: $Relative" }
    } else {
        [IO.File]::WriteAllBytes($target, $Bytes)
    }
}

function Read-FixtureZipBytes($Archive, [string]$Name) {
    $entry = $Archive.GetEntry($Name)
    if ($null -eq $entry -or $entry.Length -gt 1048576) { throw "Missing or oversized fixture entry: $Name" }
    $stream = $entry.Open()
    $memory = [IO.MemoryStream]::new()
    try {
        $stream.CopyTo($memory)
        return ,$memory.ToArray()
    } finally {
        $stream.Dispose()
        $memory.Dispose()
    }
}

function Get-FixtureSnapshot([string]$CasePath) {
    $snapshot = [ordered]@{}
    foreach ($base in @('roaming\execs', 'tf2-root', 'imports')) {
        $root = Join-Path $CasePath $base
        if (((Get-Item -LiteralPath $root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Linked fixture root: $root" }
        $entries = @(Get-ChildItem -LiteralPath $root -Force -Recurse | Sort-Object FullName)
        foreach ($entry in $entries) {
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Linked fixture path: $($entry.FullName)" }
            if (-not $entry.PSIsContainer) {
                $relative = $entry.FullName.Substring($CasePath.Length + 1).Replace('\', '/')
                $snapshot[$relative] = (Get-FileHash -LiteralPath $entry.FullName -Algorithm SHA256).Hash
            }
        }
    }
    return $snapshot
}

function Initialize-InactiveLibraryFixture([string]$CasePath) {
    $root = Join-Path $CasePath 'tf2-root'
    $data = Join-Path $CasePath 'roaming\execs'
    $profiles = Join-Path $data 'profiles'
    if (Test-Path -LiteralPath $root) { throw 'Inactive fixture root must be fresh.' }
    if (Test-Path -LiteralPath $profiles) { throw 'Inactive fixture library must be fresh.' }
    [IO.Directory]::CreateDirectory($profiles) | Out-Null
    $enc = [Text.UTF8Encoding]::new($false)
    Write-FixtureBytes $root 'tf\steam.inf' $enc.GetBytes("appID=440`n")
    Write-FixtureBytes $root 'tf\cfg\config_default.cfg' $enc.GetBytes("unbindall`nbind w +forward`n")
    Write-FixtureBytes $root 'tf\cfg\autoexec.cfg' $enc.GetBytes("// Native QA sentinel - must remain unchanged`necho native_qa_fixture`n")
    Write-FixtureBytes $root 'tf\custom\native-qa-sentinel\resource\preserved.txt' $enc.GetBytes("Untouched synthetic live surface`n")
    $summaries = @()
    $sources = @()
    foreach ($spec in $fixtureArchiveSpecs) {
        $source = Join-Path (Join-Path $fixtureExports $spec.Folder) 'exported-by-v0.1.8.zip'
        if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $spec.Hash) { throw "Retained export changed: $source" }
        $archive = [IO.Compression.ZipFile]::OpenRead($source)
        try {
            $names = @($archive.Entries | ForEach-Object { $_.FullName })
            if ($names.Count -gt 30 -or @($names | Select-Object -Unique).Count -ne $names.Count) { throw 'Unexpected fixture ZIP shape.' }
            $manifest = $enc.GetString((Read-FixtureZipBytes $archive 'execs-profile.json')) | ConvertFrom-Json
            if ($manifest.schema -ne 1) { throw 'Expected schema-1 public export.' }
            $id = [Guid]::NewGuid().ToString()
            $profile = Join-Path $profiles $id
            [IO.Directory]::CreateDirectory($profile) | Out-Null
            foreach ($file in $manifest.files) {
                $parts = $file.path.Split('/')
                if ($file.path -notmatch '^tf/(cfg|custom)/' -or $file.path.Contains('\') -or $file.path.Contains(':') -or @($parts | Where-Object { $_ -in @('', '.', '..') }).Count -gt 0) { throw 'Invalid fixture payload path.' }
                if ($file.sha256 -notmatch '^[0-9a-f]{64}$') { throw 'Invalid fixture payload digest.' }
                if ($file.storage -eq 'exclusive') {
                    $member = 'files/' + $file.path
                    $destinationRoot = $profile
                    $relative = $member
                } elseif ($file.storage -eq 'shared' -and $file.path -eq 'tf/custom/mastercomfig-base.vpk') {
                    $member = 'blobs/' + $file.sha256
                    $destinationRoot = $profiles
                    $relative = 'blobs/sha256/' + $file.sha256.Substring(0, 2) + '/' + $file.sha256
                } else { throw 'Unexpected fixture storage.' }
                [byte[]]$bytes = Read-FixtureZipBytes $archive $member
                $hasher = [Security.Cryptography.SHA256]::Create()
                try { $digest = ([BitConverter]::ToString($hasher.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $hasher.Dispose() }
                if ($digest -ne $file.sha256) { throw "Fixture payload mismatch: $member" }
                Write-FixtureBytes $destinationRoot $relative $bytes
            }
            # Export payload/records remain intact. Add recipient-only library metadata.
            $manifest | Add-Member -NotePropertyName id -NotePropertyValue $id -Force
            $manifest | Add-Member -NotePropertyName tf2Root -NotePropertyValue $root -Force
            $manifest | Add-Member -NotePropertyName name -NotePropertyValue $spec.Name -Force
            $manifest | Add-Member -NotePropertyName launchSyncPending -NotePropertyValue $true -Force
            Write-FixtureJson (Join-Path $profile 'manifest.json') $manifest
            $now = [DateTime]::UtcNow.ToString('o')
            $summaries += [ordered]@{ id=$id; name=$spec.Name; createdAt=$now; updatedAt=$now }
            $sources += [ordered]@{ id=$id; source=$source; sourceSha256=$spec.Hash; name=$spec.Name }
        } finally { $archive.Dispose() }
    }
    Write-FixtureJson (Join-Path $profiles 'index.json') ([ordered]@{ schema=1; tf2Root=$root; activeProfileId=$null; profiles=$summaries })
    Write-FixtureJson (Join-Path $data 'settings.json') ([ordered]@{ schema=1; tf2Root=$root; preferences=[ordered]@{ checkForUpdatesOnStartup=$false; motion='system' } })
    $reviewSource = Join-Path $fixtureExports 'multi-hud-change-owner\exported-by-v0.1.8.zip'
    if ((Get-FileHash -LiteralPath $reviewSource -Algorithm SHA256).Hash -ne $fixtureReviewHash) { throw 'Retained multi-HUD review export changed.' }
    Write-FixtureBytes $CasePath 'imports\review-multiple-huds-v018.zip' ([IO.File]::ReadAllBytes($reviewSource))
    Write-FixtureJson (Join-Path $CasePath 'inactive-library-sources.json') $sources
    Write-FixtureJson (Join-Path $CasePath 'inactive-library-baseline.json') (Get-FixtureSnapshot $CasePath)
    Assert-InactiveLibraryFixture $CasePath
    return [ordered]@{ root=$root; profileIds=@($summaries | ForEach-Object { $_.id }); reviewArchive=(Join-Path $CasePath 'imports\review-multiple-huds-v018.zip'); reviewArchiveSha256=$fixtureReviewHash }
}

function Assert-InactiveLibraryFixture([string]$CasePath) {
    $root = Join-Path $CasePath 'tf2-root'
    $data = Join-Path $CasePath 'roaming\execs'
    $settings = Get-Content -LiteralPath (Join-Path $data 'settings.json') -Raw | ConvertFrom-Json
    $index = Get-Content -LiteralPath (Join-Path $data 'profiles\index.json') -Raw | ConvertFrom-Json
    if ($settings.tf2Root -ne $root -or $index.tf2Root -ne $root -or $index.schema -ne 1 -or $null -ne $index.activeProfileId -or $index.profiles.Count -ne 2) { throw 'Inactive fixture identity/state changed.' }
    if ($index.PSObject.Properties.Name -contains 'pendingSwitch' -or $index.PSObject.Properties.Name -contains 'interruptedProfileId') { throw 'Inactive fixture must not carry switch state.' }
    foreach ($forbidden in @('maintenance', 'preloader')) { if (Test-Path -LiteralPath (Join-Path $data $forbidden)) { throw "Unexpected $forbidden state." } }
    $baseline = Get-Content -LiteralPath (Join-Path $CasePath 'inactive-library-baseline.json') -Raw | ConvertFrom-Json
    $actual = Get-FixtureSnapshot $CasePath
    if (@($baseline.PSObject.Properties).Count -ne $actual.Count) { throw 'Inactive fixture file inventory changed.' }
    foreach ($property in $baseline.PSObject.Properties) { if ($actual[$property.Name] -ne $property.Value) { throw "Inactive fixture bytes changed: $($property.Name)" } }
}
