# Data-only preparation/audit for one native inactive import, export and reopen.
# No app launch, Steam lookup, registry access, or product-file mutation.
. (Join-Path $PSScriptRoot 'InactiveLibraryFixture.ps1')

function Assert-InactiveImportCasePath([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $prefix = 'G:\Projects\execs\.artifacts\native-isolation\'
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Expected a private native-isolation case.' }
    $walk = $full
    while ($walk) {
        if (((Get-Item -LiteralPath $walk -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Linked case boundary: $walk" }
        $parent = [IO.Directory]::GetParent($walk)
        if ($null -eq $parent) { break }
        $walk = $parent.FullName
    }
    return $full
}

function ConvertTo-InactiveImportCanonicalJson($Value) {
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [Collections.IDictionary]) {
        $members = foreach ($key in @($Value.Keys | Sort-Object)) {
            (ConvertTo-Json -InputObject ([string]$key) -Compress) + ':' + (ConvertTo-InactiveImportCanonicalJson $Value[$key])
        }
        return '{' + ($members -join ',') + '}'
    }
    if ($Value -is [Collections.IEnumerable] -and $Value -isnot [string]) {
        $members = foreach ($item in $Value) { ConvertTo-InactiveImportCanonicalJson $item }
        return '[' + ($members -join ',') + ']'
    }
    return ConvertTo-Json -InputObject $Value -Compress
}

function Assert-InactiveImportJsonEqual($Actual, $Expected, [string]$Description) {
    if ((ConvertTo-InactiveImportCanonicalJson $Actual) -cne (ConvertTo-InactiveImportCanonicalJson $Expected)) { throw "Unexpected $Description." }
}

function Get-InactiveImportByteHash([byte[]]$Bytes) {
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hasher.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose() }
}

function Get-InactiveImportTree([string]$CasePath) {
    $files = [ordered]@{}
    $directories = [Collections.Generic.List[string]]::new()
    foreach ($base in @('roaming\execs', 'tf2-root', 'imports', 'exports')) {
        $checked = $CasePath
        foreach ($component in $base.Split('\')) {
            $checked = Join-Path $checked $component
            if (((Get-Item -LiteralPath $checked -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Linked fixture parent: $checked" }
        }
        $queue = [Collections.Generic.Queue[string]]::new()
        $queue.Enqueue((Join-Path $CasePath $base))
        while ($queue.Count -gt 0) {
            $directory = $queue.Dequeue()
            $item = Get-Item -LiteralPath $directory -Force
            if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Invalid fixture directory: $directory" }
            $directories.Add($directory.Substring($CasePath.Length + 1).Replace('\', '/'))
            foreach ($entry in Get-ChildItem -LiteralPath $directory -Force) {
                if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Linked fixture entry: $($entry.FullName)" }
                if ($entry.PSIsContainer) { $queue.Enqueue($entry.FullName) }
                else {
                    $relative = $entry.FullName.Substring($CasePath.Length + 1).Replace('\', '/')
                    $files[$relative] = (Get-FileHash -LiteralPath $entry.FullName -Algorithm SHA256).Hash
                }
            }
        }
    }
    return @{ files=$files; directories=@($directories) }
}

function Assert-InactiveImportDirectories($Tree, $ExpectedFiles, [bool]$AllowEmptyBlobIncoming = $false) {
    $allowed = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($base in @('roaming/execs', 'tf2-root', 'imports', 'exports')) { [void]$allowed.Add($base) }
    foreach ($relative in $ExpectedFiles.Keys) {
        $parent = [string]$relative
        while ($parent.Contains('/')) {
            $parent = $parent.Substring(0, $parent.LastIndexOf('/'))
            [void]$allowed.Add($parent)
        }
    }
    # blob::put_blob_from_path_exact removes its temporary file but leaves this
    # ordinary storage container. It is not a recoverable transaction marker.
    $incoming = 'roaming/execs/profiles/blobs/sha256/.incoming'
    if ($AllowEmptyBlobIncoming) {
        if (@($Tree.files.Keys | Where-Object { $_ -ceq $incoming -or $_.StartsWith($incoming + '/', [StringComparison]::Ordinal) }).Count -gt 0 -or @($Tree.directories | Where-Object { $_.StartsWith($incoming + '/', [StringComparison]::Ordinal) }).Count -gt 0) { throw 'Blob incoming container must be exactly empty.' }
        [void]$allowed.Add($incoming)
    }
    foreach ($directory in $Tree.directories) {
        if (-not $allowed.Contains($directory)) { throw "Unexpected directory/recovery or staging state: $directory" }
    }
}

function Read-InactiveImportArchive([string]$Path) {
    if ((Get-Item -LiteralPath $Path).Length -gt 2097152) { throw 'Fixture archive exceeded its bounded size.' }
    $archive = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
        if ($archive.Entries.Count -gt 32) { throw 'Unexpected fixture archive entry count.' }
        $members = [ordered]@{}
        foreach ($entry in $archive.Entries) {
            if ($members.Contains($entry.FullName)) { throw 'Duplicate fixture archive entry.' }
            $members[$entry.FullName] = Get-InactiveImportByteHash (Read-FixtureZipBytes $archive $entry.FullName)
        }
        $manifest = [Text.Encoding]::UTF8.GetString((Read-FixtureZipBytes $archive 'execs-profile.json')) | ConvertFrom-Json -AsHashtable
        $expectedMembers = [ordered]@{ 'execs-profile.json'=$members['execs-profile.json'] }
        $paths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($file in $manifest.files) {
            if (-not $paths.Add($file.path) -or $file.path -notmatch '^tf/(cfg|custom)/' -or $file.path.Contains('\') -or $file.path.Contains(':') -or @($file.path.Split('/') | Where-Object { $_ -in @('', '.', '..') }).Count -gt 0) { throw 'Invalid fixture payload identity.' }
            if ($file.sha256 -cnotmatch '^[0-9a-f]{64}$') { throw 'Invalid fixture payload digest.' }
            if ($file.storage -eq 'exclusive') { $member = 'files/' + $file.path }
            elseif ($file.storage -eq 'shared' -and $file.path -eq 'tf/custom/mastercomfig-base.vpk') { $member = 'blobs/' + $file.sha256 }
            else { throw 'Unexpected fixture storage.' }
            if ($members[$member] -cne $file.sha256) { throw "Fixture ZIP payload hash mismatch: $member" }
            $expectedMembers[$member] = $file.sha256
        }
        Assert-InactiveImportJsonEqual $members $expectedMembers 'archive member inventory'
        return @{ manifest=$manifest; members=$members }
    } finally { $archive.Dispose() }
}

function Initialize-InactiveImportPlan([string]$CasePath) {
    $casePath = Assert-InactiveImportCasePath $CasePath
    Assert-InactiveLibraryFixture $casePath
    $planPath = Join-Path $casePath 'inactive-import-plan.json'
    if (Test-Path -LiteralPath $planPath) { throw 'Import plan already exists.' }
    [IO.Directory]::CreateDirectory((Join-Path $casePath 'exports')) | Out-Null
    $plan = [ordered]@{
        schema=1
        exporterTag='v0.1.8'
        exporterRevision='85aaf6bc0dd28f43351d4cb5cdb62502737688d5'
        archiveRelative='imports/review-multiple-huds-v018.zip'
        archiveSha256=$fixtureReviewHash
        selectedHud='secondhud'
        expectedHudRoots=@('fixturehud', 'secondhud')
        exportRelative='exports/native-multiple-huds-v018.zip'
        baselineSha256=(Get-FileHash -LiteralPath (Join-Path $casePath 'inactive-library-baseline.json') -Algorithm SHA256).Hash
        sourcesSha256=(Get-FileHash -LiteralPath (Join-Path $casePath 'inactive-library-sources.json') -Algorithm SHA256).Hash
        originalIndex=(Get-Content -LiteralPath (Join-Path $casePath 'roaming/execs/profiles/index.json') -Raw | ConvertFrom-Json -AsHashtable)
    }
    Write-FixtureJson $planPath $plan
    return @{ planRelative='inactive-import-plan.json'; planSha256=(Get-FileHash -LiteralPath $planPath -Algorithm SHA256).Hash }
}

function Get-InactiveImportAudit([string]$CasePath, [ValidateSet('Initial','Imported','Exported')] [string]$Phase) {
    $casePath = Assert-InactiveImportCasePath $CasePath
    foreach ($name in @('request.json','inactive-import-plan.json','inactive-library-baseline.json','inactive-library-sources.json')) {
        $evidence = Get-Item -LiteralPath (Join-Path $casePath $name) -Force
        if ($evidence.PSIsContainer -or ($evidence.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $evidence.Length -gt 1048576) { throw "Invalid fixture evidence file: $name" }
    }
    $request = Get-Content -LiteralPath (Join-Path $casePath 'request.json') -Raw | ConvertFrom-Json -AsHashtable
    if ($request.scenario -cne 'InactiveImport' -or $request.inactiveImport.planRelative -cne 'inactive-import-plan.json') { throw 'Expected the explicit inactive import scenario.' }
    if ((Get-FileHash -LiteralPath $request.executable -Algorithm SHA256).Hash -ne $request.executableSha256) { throw 'Prepared executable changed.' }
    $planPath = Join-Path $casePath 'inactive-import-plan.json'
    if ((Get-FileHash -LiteralPath $planPath -Algorithm SHA256).Hash -ne $request.inactiveImport.planSha256) { throw 'Import plan changed.' }
    $plan = Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json -AsHashtable
    if ($plan.schema -ne 1 -or $plan.archiveRelative -cne 'imports/review-multiple-huds-v018.zip' -or $plan.archiveSha256 -ne $fixtureReviewHash -or $plan.selectedHud -cne 'secondhud' -or $plan.exportRelative -cne 'exports/native-multiple-huds-v018.zip') { throw 'Unexpected bounded import plan.' }
    foreach ($spec in @(@{name='inactive-library-baseline.json'; hash=$plan.baselineSha256}, @{name='inactive-library-sources.json'; hash=$plan.sourcesSha256})) {
        if ((Get-FileHash -LiteralPath (Join-Path $casePath $spec.name) -Algorithm SHA256).Hash -ne $spec.hash) { throw "Original fixture evidence changed: $($spec.name)" }
    }
    $tree = Get-InactiveImportTree $casePath
    $actual = $tree.files
    if ($actual[$plan.archiveRelative] -ne $plan.archiveSha256) { throw 'Copied public export changed.' }
    $source = Read-InactiveImportArchive (Join-Path $casePath $plan.archiveRelative)
    if ($source.manifest.files.Count -ne 10 -or $source.manifest.hud.id -cne 'fixturehud') { throw 'Unexpected public multi-HUD source.' }
    $baseline = Get-Content -LiteralPath (Join-Path $casePath 'inactive-library-baseline.json') -Raw | ConvertFrom-Json -AsHashtable
    $expected = [ordered]@{}
    foreach ($key in $baseline.Keys) { $expected[$key] = $baseline[$key] }
    $indexRelative = 'roaming/execs/profiles/index.json'
    $index = Get-Content -LiteralPath (Join-Path $casePath $indexRelative) -Raw | ConvertFrom-Json -AsHashtable
    if ($null -ne $index.activeProfileId) { throw 'Fixture must remain inactive.' }
    $indexShape = [ordered]@{ schema=$index.schema; tf2Root=$index.tf2Root; activeProfileId=$index.activeProfileId; profiles=$index.profiles }
    Assert-InactiveImportJsonEqual $index $indexShape 'index fields or pending switch state'
    if ($index.schema -ne 1 -or $index.tf2Root -cne (Join-Path $casePath 'tf2-root')) { throw 'Fixture root changed.' }
    foreach ($old in $plan.originalIndex.profiles) {
        $matches = @($index.profiles | Where-Object { $_.id -ceq $old.id })
        if ($matches.Count -ne 1) { throw 'A pre-existing profile was added or removed.' }
        Assert-InactiveImportJsonEqual $matches[0] $old 'pre-existing profile summary'
    }
    $importedId = $null
    $payloadChecks = @()
    $exportHash = $null
    if ($Phase -eq 'Initial') {
        Assert-InactiveImportJsonEqual $index $plan.originalIndex 'initial index'
    } else {
        $previousIds = @($plan.originalIndex.profiles | ForEach-Object { $_.id })
        $added = @($index.profiles | Where-Object { $_.id -cnotin $previousIds })
        if ($index.profiles.Count -ne 3 -or $added.Count -ne 1 -or $added[0].id -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -or $added[0].name -cne $source.manifest.name) { throw 'Expected exactly one imported profile with the reviewed name.' }
        $importedId = $added[0].id
        $manifestRelative = "roaming/execs/profiles/$importedId/manifest.json"
        $manifest = Get-Content -LiteralPath (Join-Path $casePath $manifestRelative) -Raw | ConvertFrom-Json -AsHashtable
        $expectedManifest = (ConvertTo-Json -InputObject $source.manifest -Depth 40 | ConvertFrom-Json -AsHashtable)
        $expectedManifest.id = $importedId
        $expectedManifest.tf2Root = $index.tf2Root
        $expectedManifest.launchSyncPending = $true
        $expectedManifest.hudRoots = @('fixturehud','secondhud')
        $expectedManifest.hudSelectedRoot = 'secondhud'
        $expectedManifest.hudReviewPending = $true
        $expectedManifest.preloader = @{ addons=@(); particleMods=@(); profileParticleMods=@() }
        Assert-InactiveImportJsonEqual $manifest $expectedManifest 'imported manifest, preserved records, ownership, or empty preloader'
        $expected[$indexRelative] = $actual[$indexRelative]
        $expected[$manifestRelative] = $actual[$manifestRelative]
        foreach ($file in $source.manifest.files) {
            if ($file.storage -eq 'exclusive') { $relative = "roaming/execs/profiles/$importedId/files/" + $file.path }
            else { $relative = 'roaming/execs/profiles/blobs/sha256/' + $file.sha256.Substring(0,2) + '/' + $file.sha256 }
            $expected[$relative] = $file.sha256.ToUpperInvariant()
            $payloadChecks += [ordered]@{ path=$file.path; storage=$file.storage; sourceSha256=$file.sha256; importedSha256=$actual[$relative] }
        }
        if ($Phase -eq 'Exported') {
            $exportPath = Join-Path $casePath $plan.exportRelative
            $export = Read-InactiveImportArchive $exportPath
            $expectedExport = (ConvertTo-Json -InputObject $source.manifest -Depth 40 | ConvertFrom-Json -AsHashtable)
            $expectedExport.hudSelectedRoot = 'secondhud'
            $expectedExport.hudReviewPending = $true
            $expectedExport.preloader = @{ addons=@(); particleMods=@(); profileParticleMods=@() }
            Assert-InactiveImportJsonEqual $export.manifest $expectedExport 'exported portable manifest and ownership'
            foreach ($member in $source.members.Keys) {
                if ($member -eq 'execs-profile.json') { continue }
                if ($export.members[$member] -cne $source.members[$member]) { throw "Exported payload changed: $member" }
            }
            $exportHash = $actual[$plan.exportRelative]
            $expected[$plan.exportRelative] = $exportHash
        }
    }
    Assert-InactiveImportJsonEqual $actual $expected 'fixture file inventory or payload bytes'
    Assert-InactiveImportDirectories $tree $expected ($Phase -ne 'Initial')
    return [ordered]@{
        passed=$true; phase=$Phase; checkedUtc=[DateTime]::UtcNow.ToString('o'); caseDirectory=$casePath
        executable=$request.executable; executableSha256=$request.executableSha256
        importPlanSha256=$request.inactiveImport.planSha256; exporterTag=$plan.exporterTag; exporterRevision=$plan.exporterRevision
        archiveSha256=$plan.archiveSha256; exportSha256=$exportHash; importedProfileId=$importedId
        activeProfileId=$null; selectedHud=$(if ($importedId) { 'secondhud' } else { $null })
        hudReviewPending=$(if ($importedId) { $true } else { $null }); payloadChecks=$payloadChecks
        baselineFiles=$baseline.Count; actualFiles=$actual.Count; preExistingFilesUnchanged=($baseline.Count - $(if ($importedId) { 1 } else { 0 }))
        onlyPreExistingChange=$(if ($importedId) { $indexRelative } else { $null }); actualSha256=$actual
        note='Data-only audit. Existing app data, profiles, payloads, shared blobs, input ZIP and synthetic live files are exact; only the index and explicitly reviewed imported profile/export may differ. WebView caches and OS files are outside this comparison.'
    }
}

function Assert-InactiveImportSession([string]$CasePath) {
    foreach ($name in @('request.json','launch.json','exit.json')) {
        $evidence = Get-Item -LiteralPath (Join-Path $CasePath $name) -Force
        if ($evidence.PSIsContainer -or ($evidence.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $evidence.Length -gt 1048576) { throw "Invalid native session evidence: $name" }
    }
    $request = Get-Content -LiteralPath (Join-Path $CasePath 'request.json') -Raw | ConvertFrom-Json -AsHashtable
    $launch = Get-Content -LiteralPath (Join-Path $CasePath 'launch.json') -Raw | ConvertFrom-Json -AsHashtable
    $exit = Get-Content -LiteralPath (Join-Path $CasePath 'exit.json') -Raw | ConvertFrom-Json -AsHashtable
    if ($launch.executable -cne $request.executable -or $launch.executableSha256 -ne $request.executableSha256 -or $launch.scenario -cne 'InactiveImport') { throw 'Native session binary or scenario mismatch.' }
    if ($launch.helperParentName -cne 'explorer.exe' -or $launch.helperParentPackageCode -ne 15700 -or $launch.helperPackageCode -ne 15700 -or $launch.appPackageCode -ne 15700) { throw 'Native session package identity was not verified.' }
    if ($exit.exitCode -ne 0 -or $exit.appPid -ne $launch.appPid) { throw 'The recorded native session did not exit normally.' }
    if ($launch.appData -cne (Join-Path $CasePath 'roaming') -or $launch.webviewUserDataFolder -cne (Join-Path $CasePath 'webview2') -or $launch.workingDirectory -cne (Join-Path $CasePath 'work')) { throw 'Native session paths escaped the prepared case.' }
    return @{ appPid=$launch.appPid; launchedUtc=$launch.launchedUtc; exitedUtc=$exit.exitedUtc; exitCode=$exit.exitCode }
}

function Assert-InactiveImportReopen([string]$CasePath) {
    $audit = Get-InactiveImportAudit $CasePath 'Exported'
    $session = Assert-InactiveImportSession $CasePath
    $reportPath = Join-Path $CasePath 'post-import-export-integrity.json'
    $reportFile = Get-Item -LiteralPath $reportPath -Force
    if ($reportFile.PSIsContainer -or ($reportFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $reportFile.Length -gt 1048576) { throw 'Invalid post-import/export evidence.' }
    $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json -AsHashtable
    if (-not $report.passed -or $report.phase -cne 'Exported' -or $report.executableSha256 -ne $audit.executableSha256 -or $report.importedProfileId -cne $audit.importedProfileId -or $report.session.appPid -ne $session.appPid) { throw 'A successful post-import/export native-session report is required before reopen.' }
    Assert-InactiveImportJsonEqual $audit.actualSha256 $report.actualSha256 'post-import/export snapshot before reopen'
    return $audit
}
