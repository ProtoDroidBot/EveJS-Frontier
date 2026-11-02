#requires -Version 7.2
[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments = $true)] [string[]]$HostArgument)
$ErrorActionPreference = 'Stop'
$entry = Join-Path $PSScriptRoot 'tools/frontier-host/index.mjs'
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
    throw 'Host tools are not compiled. Run npm ci --include=dev, then npm run build:tools.'
}
& node $entry @HostArgument
exit $LASTEXITCODE
