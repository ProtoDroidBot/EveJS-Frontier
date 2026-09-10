[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$npm = Get-Command npm.cmd, npm -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
if (-not $npm) {
    throw 'npm is required to build EveJS. Install Node.js 24 LTS and open a fresh terminal.'
}

Push-Location $repoRoot
try {
    # Include development dependencies even when NODE_ENV=production: the
    # TypeScript compiler is needed on source checkouts, before Node can run.
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules\typescript\bin\tsc'))) {
        Write-Host '[evejs] Installing the TypeScript build dependencies ...'
        & $npm.Source ci --include=dev
        if ($LASTEXITCODE -ne 0) { throw 'Root npm ci failed.' }
    }
    Write-Host '[evejs] Compiling TypeScript ...'
    & $npm.Source run build
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript build failed.' }
}
finally {
    Pop-Location
}
