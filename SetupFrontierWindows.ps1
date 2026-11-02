#requires -Version 7.0

[CmdletBinding()]
param(
    [ValidateRange(0, 2147483647)] [int]$Build = 0,
    [string]$SourceRoot,
    [string]$Python,
    [string]$StagingBase,
    [switch]$NonInteractive,
    [switch]$Status,
    [switch]$DryRun,
    [switch]$CopyResFiles,
    [switch]$CleanStage,
    [switch]$SkipStage,
    [switch]$SkipDapp,
    [switch]$ForceData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'SetupFrontierWindows.ps1 supports Windows only.' }

$RepoRoot = [IO.Path]::GetFullPath($PSScriptRoot)
Import-Module (Join-Path $RepoRoot 'tools\frontier-client\FrontierWindows.Common.psm1') -Force

function Write-SetupStep { param([string]$Message) Write-Host "[evejs-frontier] $Message" -ForegroundColor Cyan }

function Invoke-WingetInstall {
    param([Parameter(Mandatory)] [string]$Id)
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $winget) { throw "winget is required to install missing prerequisite $Id." }
    Write-SetupStep "Installing missing prerequisite: $Id"
    & $winget.Source install --exact --id $Id --accept-package-agreements `
        --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) { throw "winget failed to install $Id (exit $LASTEXITCODE)." }
}

function Get-GitPath {
    $git = Get-Command git.exe -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($git) { return $git.Source }
    if ($env:ProgramFiles) {
        $candidate = Join-Path $env:ProgramFiles 'Git\cmd\git.exe'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    return $null
}

function Get-PrerequisiteReport {
    $git = Get-GitPath
    $node = $null
    $pythonPath = $null
    try { $node = Get-FrontierNodePath } catch {}
    try { $pythonPath = Get-FrontierPython312Path -RepoRoot $RepoRoot -PythonPath $script:Python } catch {}
    $gitVersion = if ($git) { (& $git --version) -replace '^git version\s+', '' } else { $null }
    $nodeVersion = if ($node) { (& $node --version).Trim() } else { $null }
    $npmVersion = if ($node) { (& (Get-FrontierNpmPath) --version).Trim() } else { $null }
    $pythonVersion = if ($pythonPath) { (& $pythonPath --version 2>&1).ToString().Trim() } else { $null }
    return [ordered]@{
        git = $gitVersion
        powerShell = $PSVersionTable.PSVersion.ToString()
        node = $nodeVersion
        npm = $npmVersion
        python = $pythonVersion
        nodePath = $node
        pythonPath = $pythonPath
    }
}

function Ensure-Prerequisites {
    if (-not (Get-GitPath)) { Invoke-WingetInstall 'Git.Git' }
    try { [void](Get-FrontierNodePath) } catch { Invoke-WingetInstall 'OpenJS.NodeJS.LTS' }
    if ($Python -or $env:EVEJS_FRONTIER_NATIVE_PYTHON312) {
        [void](Get-FrontierPython312Path -RepoRoot $RepoRoot -PythonPath $Python)
    }
    else {
        try { [void](Get-FrontierPython312Path -RepoRoot $RepoRoot) }
        catch { Invoke-WingetInstall 'Python.Python.3.12' }
    }

    $node = Get-FrontierNodePath
    $nodeVersion = (& $node --version).Trim()
    if ($nodeVersion -notmatch '^v24\.') {
        throw "Node.js 24 LTS is required; resolved $nodeVersion at $node"
    }
    $python = Get-FrontierPython312Path -RepoRoot $RepoRoot -PythonPath $Python
    $implementation = & $python -c 'import platform; print(platform.python_implementation())'
    if ($implementation.Trim() -ne 'CPython') { throw 'CPython 3.12 x64 is required.' }
}

# This entry point retains Windows prerequisite installation and discovery.
# All preparation phases are planned and run by the shared host workflow.
$report = Get-PrerequisiteReport
if ($Status) {
    Write-Output ($report | ConvertTo-Json -Depth 4)
    try {
        $client = Invoke-FrontierDiscovery -RepoRoot $RepoRoot -SourceRoot $SourceRoot -Build $Build
        Write-Output "[evejs-frontier] Installed Frontier: build=$($client.metadata.build) sync=$($client.metadata.sync) root=$($client.buildRoot)"
        $stageStatus = @{
            SourceRoot = $client.buildRoot
            Build = [int]$client.metadata.build
            Status = $true
        }
        if ($StagingBase) { $stageStatus.StagingBase = $StagingBase }
        & (Join-Path $RepoRoot 'StageFrontierClient.ps1') @stageStatus
        & (Join-Path $RepoRoot 'StartFrontierServer.ps1') -Build ([string]$client.metadata.build) -Status
    }
    catch { Write-Warning $_.Exception.Message }
    return
}

if ($DryRun) { Write-Output ($report | ConvertTo-Json -Depth 4) }
else { Ensure-Prerequisites }
$node = Get-FrontierNodePath
$nodeDirectory = Split-Path -Parent $node
$oldPath = $env:Path
$env:Path = "$nodeDirectory;$oldPath"
Push-Location -LiteralPath $RepoRoot
try {
    $hostEntry = Join-Path $RepoRoot 'tools\frontier-host\index.mjs'
    if ($DryRun) {
        if (-not (Test-Path -LiteralPath $hostEntry -PathType Leaf)) {
            throw 'Host tools are not compiled. Run npm ci --include=dev --ignore-scripts, then npm run build:tools before previewing setup.'
        }
        foreach ($source in Get-ChildItem -LiteralPath (Split-Path -Parent $hostEntry) -Filter '*.mts' -File |
            Where-Object { $_.Name -notlike '*.test.mts' }) {
            $emitted = [IO.Path]::ChangeExtension($source.FullName, '.mjs')
            if (-not (Test-Path -LiteralPath $emitted -PathType Leaf) -or
                $source.LastWriteTimeUtc -gt (Get-Item -LiteralPath $emitted).LastWriteTimeUtc) {
                throw 'Host tools are stale. Run npm run build:tools before previewing setup.'
            }
        }
    }
    else {
        $npm = Get-FrontierNpmPath
        if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'node_modules\typescript\bin\tsc') -PathType Leaf)) {
            Write-SetupStep 'Bootstrapping the shared host compiler ...'
            & $npm --prefix $RepoRoot ci --include=dev --ignore-scripts
            if ($LASTEXITCODE -ne 0) { throw 'Root npm ci failed while bootstrapping host tools.' }
        }
        # Existing ignored JavaScript may belong to the old host that called this
        # script. Rebuild every actual run before delegating to avoid recursion.
        Write-SetupStep 'Compiling the shared host workflow ...'
        & $npm --prefix $RepoRoot run build:tools
        if ($LASTEXITCODE -ne 0) { throw 'Host tool compilation failed.' }
    }

    $client = Invoke-FrontierDiscovery -RepoRoot $RepoRoot -SourceRoot $SourceRoot -Build $Build
    $hostArguments = @($hostEntry, 'setup', '--build', [string]$client.metadata.build,
        '--client-root', [string]$client.buildRoot)
    if ($DryRun) {
        if ($Python) { $hostArguments += @('--python', $Python) }
        $hostArguments += '--dry-run'
    }
    else {
        $nativePython = Get-FrontierPython312Path -RepoRoot $RepoRoot -PythonPath $Python
        $hostArguments += @('--python', $nativePython)
    }
    if ($StagingBase) { $hostArguments += @('--staging-base', [IO.Path]::GetFullPath($StagingBase)) }
    if ($SkipStage) { $hostArguments += '--skip-stage' }
    if ($SkipDapp) { $hostArguments += '--skip-dapp' }
    if ($CleanStage) { $hostArguments += '--clean-stage' }
    if ($CopyResFiles) { $hostArguments += '--copy-resfiles' }
    if ($ForceData) { $hostArguments += '--force-data' }
    & $node @hostArguments
    if ($LASTEXITCODE -ne 0) { throw "Shared Frontier setup failed (exit $LASTEXITCODE)." }
}
finally {
    Pop-Location
    $env:Path = $oldPath
}
