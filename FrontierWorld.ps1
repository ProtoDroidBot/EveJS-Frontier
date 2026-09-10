#requires -Version 7.0

<#
.SYNOPSIS
Synchronizes the live efctl world into EveJS and manages its Docker localnet.

.DESCRIPTION
The default efctl workspace is the build-numbered sibling of this repository
(../3502403). The tool always resolves efctl.exe from PATH unless -EfctlPath is
provided. It never installs, copies, pins, or updates efctl.

The synchronized EveJS file contains the current localnet world IDs and only
the admin signer needed for character provisioning. It is stored under the
gitignored _local directory with an ACL restricted to the current Windows user.

.EXAMPLE
.\FrontierWorld.ps1 sync

.EXAMPLE
.\FrontierWorld.ps1 up

.EXAMPLE
.\FrontierWorld.ps1 restart --with-frontend --with-graphql

.EXAMPLE
.\FrontierWorld.ps1 down
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('sync', 'up', 'down', 'restart', 'status')]
    [string]$Command = 'sync',

    [ValidatePattern('^\d+$')]
    [string]$Build = '3502403',

    [string]$SourceRoot,
    [string]$DestinationRoot,
    [string]$EfctlPath,
    [switch]$DryRun,

    # Intended for tests or an intentionally remote/nonstandard localnet only.
    [switch]$SkipRpcValidation,
    [switch]$SkipDockerOwnershipCheck,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$EfctlArgument = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
# CmdletBinding consumes --debug as PowerShell's common -Debug parameter.
# Preserve it as the efctl global flag for lifecycle/status commands.
$script:ForwardEfctlDebug = $PSBoundParameters.ContainsKey('Debug')

if ($env:OS -ne 'Windows_NT') {
    throw 'FrontierWorld.ps1 supports Windows only.'
}

$script:ConfigFormat = 'evejs-frontier-world-sync-v1'
$script:PathComparison = [StringComparison]::OrdinalIgnoreCase
$RepoRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$WorkspaceParent = Split-Path -Parent $RepoRoot
if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
    $SourceRoot = Join-Path $WorkspaceParent $Build
}
$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
    $DestinationRoot = Join-Path $RepoRoot (Join-Path '_local\frontier-world' $Build)
}
$DestinationRoot = [IO.Path]::GetFullPath($DestinationRoot)
$WorldConfigPath = Join-Path $DestinationRoot 'world.private.json'
$EfctlConfigPath = Join-Path $SourceRoot 'efctl.yaml'
$WorldContractsRoot = Join-Path $SourceRoot 'world-contracts'
$CommonModule = Join-Path $RepoRoot 'tools\frontier-client\FrontierWindows.Common.psm1'

if (-not (Test-Path -LiteralPath $CommonModule -PathType Leaf)) {
    throw "Frontier Windows helper module is missing: $CommonModule"
}
Import-Module $CommonModule -Force

function Test-SamePath {
    param(
        [Parameter(Mandatory)] [string]$Left,
        [Parameter(Mandatory)] [string]$Right
    )
    return [string]::Equals(
        [IO.Path]::GetFullPath($Left).TrimEnd('\', '/'),
        [IO.Path]::GetFullPath($Right).TrimEnd('\', '/'),
        $script:PathComparison
    )
}

function Assert-SourceWorkspace {
    if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) {
        throw "efctl source workspace is missing: $SourceRoot"
    }
    if (-not (Test-Path -LiteralPath $EfctlConfigPath -PathType Leaf)) {
        throw "efctl configuration is missing: $EfctlConfigPath"
    }
    if (-not (Test-Path -LiteralPath $WorldContractsRoot -PathType Container)) {
        throw "World-contracts checkout is missing: $WorldContractsRoot"
    }
}

function Get-EfctlForwardArguments {
    param(
        [Parameter(Mandatory)]
        [ValidateSet('sync', 'up', 'down', 'restart', 'status')]
        [string]$Action
    )

    $arguments = @($EfctlArgument | Where-Object { $_ -ne '--' })
    if ($script:ForwardEfctlDebug -and $arguments -cnotcontains '--debug') {
        $arguments += '--debug'
    }
    if ($Action -eq 'sync') {
        if ($arguments.Count -gt 0) {
            throw "The sync command accepts no efctl arguments: $($arguments[0])"
        }
        return [string[]]@()
    }

    # restart accepts up options; its dispatcher forwards only --debug to down.
    $efctlAction = if ($Action -eq 'restart') { 'up' } else { $Action }
    $validated = [Collections.Generic.List[string]]::new()
    switch ($efctlAction) {
        'up' {
            foreach ($argument in $arguments) {
                if ($argument -cne '--debug' -and
                    $argument -cnotin @('--with-frontend', '--with-graphql') -and
                    $argument -cnotmatch '^--with-(frontend|graphql)=(true|false)$') {
                    throw "Unsupported efctl env up argument: $argument"
                }
                $validated.Add($argument)
            }
        }
        'down' {
            foreach ($argument in $arguments) {
                if ($argument -cne '--debug') {
                    throw "Unsupported efctl env down argument: $argument"
                }
                $validated.Add($argument)
            }
        }
        'status' {
            for ($index = 0; $index -lt $arguments.Count; $index++) {
                $argument = [string]$arguments[$index]
                if ($argument -ceq '--debug') {
                    $validated.Add($argument)
                    continue
                }

                $urlText = $null
                if ($argument -cmatch '^--rpc-url=(.+)$') {
                    $urlText = [string]$matches[1]
                    $validated.Add($argument)
                }
                elseif ($argument -ceq '--rpc-url') {
                    if ($index + 1 -ge $arguments.Count) {
                        throw '--rpc-url requires an HTTP or HTTPS URL.'
                    }
                    $urlText = [string]$arguments[++$index]
                    $validated.Add('--rpc-url')
                    $validated.Add($urlText)
                }
                else {
                    throw "Unsupported efctl env status argument: $argument"
                }

                $parsedUrl = $null
                if (-not [Uri]::TryCreate($urlText, [UriKind]::Absolute, [ref]$parsedUrl) -or
                    $parsedUrl.Scheme -notin @('http', 'https')) {
                    throw "--rpc-url must be an absolute HTTP or HTTPS URL: $urlText"
                }
            }
        }
    }
    return [string[]]$validated.ToArray()
}

function Resolve-Efctl {
    $resolved = $null
    if (-not [string]::IsNullOrWhiteSpace($EfctlPath)) {
        $candidate = [IO.Path]::GetFullPath($EfctlPath)
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            throw "The requested efctl executable is missing: $candidate"
        }
        $resolved = $candidate
    }
    else {
        $commandInfo = Get-Command efctl.exe -CommandType Application -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($null -eq $commandInfo) {
            throw 'efctl.exe is not available in PATH. Install/update it manually, then open a fresh PowerShell.'
        }
        $resolved = [IO.Path]::GetFullPath($commandInfo.Source)
    }

    $versionOutput = @(& $resolved version 2>&1)
    $versionExitCode = $LASTEXITCODE
    if ($null -ne $versionExitCode -and $versionExitCode -ne 0) {
        throw "efctl version failed with exit code ${versionExitCode}: $resolved"
    }
    $versionText = [string]::Join([Environment]::NewLine, @(
        $versionOutput | ForEach-Object { [string]$_ }
    ))
    $versionText = [regex]::Replace(
        $versionText,
        "`e\[[0-9;?]*[ -/]*[@-~]",
        ''
    )
    $match = [regex]::Match($versionText, '(?m)^efctl\s+v[^\r\n]+$')
    $version = if ($match.Success) { $match.Value.Trim() } else { 'version unknown' }
    return [pscustomobject]@{
        Path = $resolved
        Version = $version
    }
}

function Enter-WorldOperationLock {
    $mutex = [Threading.Mutex]::new(
        $false,
        'Global\EveJSFrontierWorldEnvironment'
    )
    $acquired = $false
    try {
        try {
            $acquired = $mutex.WaitOne([TimeSpan]::FromMinutes(30))
        }
        catch [Threading.AbandonedMutexException] {
            $acquired = $true
        }
        if (-not $acquired) {
            throw 'Timed out waiting for another Frontier world operation to finish.'
        }
        return $mutex
    }
    catch {
        if (-not $acquired) {
            $mutex.Dispose()
        }
        throw
    }
}

function Assert-DockerWorkspaceOwnership {
    if ($SkipDockerOwnershipCheck) {
        return
    }
    $docker = Get-Command docker.exe -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -eq $docker) {
        throw 'docker.exe is not available in PATH; cannot verify efctl container ownership.'
    }

    $containerNames = @(& $docker.Source ps -a --format '{{.Names}}' 2>$null |
        ForEach-Object { [string]$_ })
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker is unavailable; cannot verify efctl container ownership.'
    }
    $managedNames = @('sui-playground', 'efctl-postgres', 'efctl-frontend')
    $existingManaged = @($containerNames | Where-Object { $managedNames -ccontains $_ })
    if ($containerNames -cnotcontains 'sui-playground') {
        if ($existingManaged.Count -gt 0) {
            throw (
                'A partial efctl environment exists without sui-playground ' +
                "($($existingManaged -join ', ')); its workspace cannot be proven."
            )
        }
        return
    }

    $mountJson = @(& $docker.Source inspect --format '{{json .Mounts}}' sui-playground 2>$null)
    $inspectExitCode = $LASTEXITCODE
    if ($inspectExitCode -ne 0) {
        throw 'Docker could not inspect the existing sui-playground container.'
    }
    try {
        $mounts = ([string]::Join('', $mountJson) | ConvertFrom-Json)
    }
    catch {
        throw 'Docker returned malformed mount data for the existing sui-playground container.'
    }
    $worldMount = @($mounts | Where-Object {
        [string]$_.Type -eq 'bind' -and
        [string]$_.Destination -eq '/workspace/world-contracts'
    }) | Select-Object -First 1
    if ($null -eq $worldMount -or [string]::IsNullOrWhiteSpace([string]$worldMount.Source)) {
        throw 'An existing sui-playground container has no provable /workspace/world-contracts bind mount.'
    }
    $expected = [IO.Path]::GetFullPath($WorldContractsRoot)
    $actual = [IO.Path]::GetFullPath([string]$worldMount.Source)
    if (-not (Test-SamePath -Left $actual -Right $expected)) {
        throw (
            "The existing sui-playground belongs to another workspace. " +
            "Expected '$expected', found '$actual'. Refusing to operate on it."
        )
    }
}

function Format-CommandLine {
    param(
        [Parameter(Mandatory)] [string]$Executable,
        [Parameter(Mandatory)] [string[]]$Arguments
    )
    $parts = @('"' + $Executable.Replace('"', '\"') + '"')
    foreach ($argument in $Arguments) {
        if ($argument -match '[\s"]') {
            $parts += '"' + $argument.Replace('"', '\"') + '"'
        }
        else {
            $parts += $argument
        }
    }
    return ($parts -join ' ')
}

function Invoke-EfctlEnvironment {
    param(
        [Parameter(Mandatory)] [ValidateSet('up', 'down', 'status')]
        [string]$Action,
        [Parameter(Mandatory)] [object]$Efctl,
        [string[]]$ForwardedArguments = @()
    )

    Assert-SourceWorkspace
    Assert-DockerWorkspaceOwnership
    $arguments = @(
        '--no-progress',
        '--config-file', $EfctlConfigPath,
        'env', $Action,
        '--workspace', $SourceRoot
    )
    if ($ForwardedArguments.Count -gt 0) {
        $arguments += $ForwardedArguments
    }
    if ($DryRun) {
        Write-Output "[evejs-frontier-world] Would run: $(Format-CommandLine -Executable $Efctl.Path -Arguments $arguments)"
        return
    }

    & $Efctl.Path @arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "efctl env $Action failed with exit code $exitCode."
    }
}

function Get-Sha256Hex {
    param([Parameter(Mandatory)] [byte[]]$Bytes)

    return [Convert]::ToHexString(
        [Security.Cryptography.SHA256]::HashData($Bytes)
    ).ToLowerInvariant()
}

function Read-TextFileSnapshot {
    param([Parameter(Mandatory)] [string]$Path)

    $bytes = [IO.File]::ReadAllBytes($Path)
    try {
        $text = [Text.UTF8Encoding]::new($false, $true).GetString($bytes)
    }
    catch {
        throw "Required deployed-world artifact is not valid UTF-8: $Path"
    }
    if ($text.StartsWith([char]0xfeff)) {
        $text = $text.Substring(1)
    }
    return [pscustomobject]@{
        Path = $Path
        Text = $text
        Sha256 = Get-Sha256Hex -Bytes $bytes
    }
}

function Read-StableSourceSnapshots {
    param(
        [Parameter(Mandatory)] [string]$DeploymentPath,
        [Parameter(Mandatory)] [string]$PublicationPath,
        [Parameter(Mandatory)] [string]$EnvironmentPath
    )

    $paths = [ordered]@{
        Deployment = $DeploymentPath
        Publication = $PublicationPath
        Environment = $EnvironmentPath
    }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $first = @{}
        $second = @{}
        foreach ($entry in $paths.GetEnumerator()) {
            $first[$entry.Key] = Read-TextFileSnapshot -Path $entry.Value
        }
        Start-Sleep -Milliseconds 20
        foreach ($entry in $paths.GetEnumerator()) {
            $second[$entry.Key] = Read-TextFileSnapshot -Path $entry.Value
        }
        $stable = $true
        foreach ($entry in $paths.GetEnumerator()) {
            if ($first[$entry.Key].Sha256 -cne $second[$entry.Key].Sha256) {
                $stable = $false
                break
            }
        }
        if ($stable) {
            return [pscustomobject]$second
        }
    }
    throw 'World deployment artifacts are changing; wait for efctl to finish and retry.'
}

function Get-DotEnvValue {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$Text,
        [Parameter(Mandatory)] [string]$Name
    )

    $values = [Collections.Generic.List[string]]::new()
    foreach ($line in [regex]::Split($Text, '\r?\n')) {
        if ($line -notmatch ('^\s*' + [regex]::Escape($Name) + '\s*=\s*(.*)$')) {
            continue
        }
        $value = $matches[1].Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            if ($value.Length -ge 2) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }
        else {
            $value = [regex]::Replace($value, '\s+#.*$', '').Trim()
        }
        $values.Add($value)
    }
    if ($values.Count -ne 1 -or [string]::IsNullOrWhiteSpace($values[0])) {
        throw "Expected exactly one non-empty $Name entry in $Path."
    }
    if ($values[0] -match '[\r\n\x00]') {
        throw "$Name contains an invalid line break or NUL character."
    }
    return $values[0]
}

function Get-Bech32Polymod {
    param([Parameter(Mandatory)] [int[]]$Values)

    [uint64]$checksum = 1
    [uint64[]]$generators = @(
        0x3b6a57b2,
        0x26508e6d,
        0x1ea119fa,
        0x3d4233dd,
        0x2a1462b3
    )
    foreach ($value in $Values) {
        [uint64]$top = $checksum -shr 25
        $checksum = (($checksum -band 0x1ffffff) * 32) -bxor [uint64]$value
        for ($index = 0; $index -lt $generators.Count; $index++) {
            if (($top -band ([uint64]1 -shl $index)) -ne 0) {
                $checksum = $checksum -bxor $generators[$index]
            }
        }
    }
    return $checksum
}

function Assert-SuiPrivateKey {
    param(
        [Parameter(Mandatory)] [AllowEmptyString()] [string]$Value,
        [Parameter(Mandatory)] [string]$Label
    )

    if ($Value.Length -gt 90 -or $Value -cne $Value.ToLowerInvariant()) {
        throw "$Label is not a canonical Sui Bech32 private key."
    }
    $separator = $Value.LastIndexOf('1')
    if ($separator -le 0 -or $Value.Substring(0, $separator) -cne 'suiprivkey') {
        throw "$Label is not a canonical Sui Bech32 private key."
    }
    $encoded = $Value.Substring($separator + 1)
    if ($encoded.Length -lt 7) {
        throw "$Label is not a canonical Sui Bech32 private key."
    }

    $charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
    $dataValues = [Collections.Generic.List[int]]::new()
    foreach ($character in $encoded.ToCharArray()) {
        $characterValue = $charset.IndexOf($character)
        if ($characterValue -lt 0) {
            throw "$Label is not a canonical Sui Bech32 private key."
        }
        $dataValues.Add($characterValue)
    }
    $hrpValues = [Collections.Generic.List[int]]::new()
    foreach ($character in 'suiprivkey'.ToCharArray()) {
        $hrpValues.Add(([int]$character) -shr 5)
    }
    $hrpValues.Add(0)
    foreach ($character in 'suiprivkey'.ToCharArray()) {
        $hrpValues.Add(([int]$character) -band 31)
    }
    $checksumValues = @($hrpValues.ToArray()) + @($dataValues.ToArray())
    if ((Get-Bech32Polymod -Values $checksumValues) -ne 1) {
        throw "$Label has an invalid Bech32 checksum."
    }

    $payloadValues = $dataValues.GetRange(0, $dataValues.Count - 6)
    $decoded = [Collections.Generic.List[byte]]::new()
    [int]$accumulator = 0
    [int]$bitCount = 0
    foreach ($payloadValue in $payloadValues) {
        $accumulator = (($accumulator -band 4095) -shl 5) -bor $payloadValue
        $bitCount += 5
        while ($bitCount -ge 8) {
            $bitCount -= 8
            $decoded.Add([byte](($accumulator -shr $bitCount) -band 255))
        }
    }
    if ($bitCount -ge 5 -or
        (($accumulator -shl (8 - $bitCount)) -band 255) -ne 0 -or
        $decoded.Count -ne 33 -or
        $decoded[0] -ne 0) {
        throw "$Label is not a 32-byte Ed25519 Sui private key."
    }
    return $Value
}

function Assert-SuiAddress {
    param(
        [Parameter(Mandatory)] [AllowEmptyString()] [string]$Value,
        [Parameter(Mandatory)] [string]$Label
    )
    if ($Value -notmatch '^0x[0-9a-fA-F]{64}$') {
        throw "$Label is not a canonical 32-byte Sui address."
    }
    return $Value.ToLowerInvariant()
}

function Get-LiveChainIdentifier {
    try {
        $response = Invoke-RestMethod `
            -Uri 'http://127.0.0.1:9000' `
            -Method Post `
            -ContentType 'application/json' `
            -TimeoutSec 5 `
            -Body '{"jsonrpc":"2.0","id":1,"method":"sui_getChainIdentifier","params":[]}'
    }
    catch {
        throw 'The local Sui RPC at http://127.0.0.1:9000 is not ready; refusing to publish world IDs.'
    }
    $identifier = [string]$response.result
    if ($identifier -notmatch '^[0-9a-fA-F]+$') {
        throw 'The local Sui RPC returned an invalid chain identifier.'
    }
    return $identifier.ToLowerInvariant()
}

function Read-SourceWorld {
    Assert-SourceWorkspace
    $deploymentPath = Join-Path $WorldContractsRoot 'deployments\localnet\extracted-object-ids.json'
    $publicationPath = Join-Path $WorldContractsRoot 'contracts\world\Pub.localnet.toml'
    $environmentPath = Join-Path $WorldContractsRoot '.env'
    foreach ($required in @($deploymentPath, $publicationPath, $environmentPath)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "Required deployed-world artifact is missing: $required"
        }
    }

    $snapshots = Read-StableSourceSnapshots `
        -DeploymentPath $deploymentPath `
        -PublicationPath $publicationPath `
        -EnvironmentPath $environmentPath
    try {
        $deployment = $snapshots.Deployment.Text | ConvertFrom-Json
    }
    catch {
        throw "World deployment JSON is malformed: $deploymentPath"
    }
    if ([string]$deployment.network -ne 'localnet' -or $null -eq $deployment.world) {
        throw 'World deployment JSON is not a localnet world deployment.'
    }
    $packageId = Assert-SuiAddress -Value ([string]$deployment.world.packageId) -Label 'World package ID'
    $objectRegistryId = Assert-SuiAddress -Value ([string]$deployment.world.objectRegistry) -Label 'ObjectRegistry ID'
    $adminAclId = Assert-SuiAddress -Value ([string]$deployment.world.adminAcl) -Label 'AdminACL ID'

    $publicationText = $snapshots.Publication.Text
    $chainMatch = [regex]::Match($publicationText, '(?m)^chain-id\s*=\s*"([0-9a-fA-F]+)"\s*$')
    $packageMatch = [regex]::Match($publicationText, '(?m)^published-at\s*=\s*"(0x[0-9a-fA-F]{64})"\s*$')
    if (-not $chainMatch.Success -or -not $packageMatch.Success) {
        throw "World publication metadata is incomplete: $publicationPath"
    }
    $chainId = $chainMatch.Groups[1].Value.ToLowerInvariant()
    $publishedPackageId = Assert-SuiAddress -Value $packageMatch.Groups[1].Value -Label 'Published world package ID'
    if ($publishedPackageId -ne $packageId) {
        throw 'World deployment JSON and Pub.localnet.toml refer to different package IDs.'
    }
    if (-not $SkipRpcValidation) {
        $liveChainId = Get-LiveChainIdentifier
        if ($liveChainId -ne $chainId) {
            throw (
                "Deployment artifacts belong to chain '$chainId', but localhost:9000 is '$liveChainId'. " +
                'Run efctl env up successfully before syncing.'
            )
        }
    }

    $adminPrivateKey = Get-DotEnvValue `
        -Path $environmentPath `
        -Text $snapshots.Environment.Text `
        -Name 'ADMIN_PRIVATE_KEY'
    $adminPrivateKey = Assert-SuiPrivateKey `
        -Value $adminPrivateKey `
        -Label 'ADMIN_PRIVATE_KEY'
    return [pscustomobject]@{
        AdminPrivateKey = $adminPrivateKey
        ChainId = $chainId
        PackageId = $packageId
        ObjectRegistryId = $objectRegistryId
        AdminAclId = $adminAclId
        DeploymentSha256 = $snapshots.Deployment.Sha256
        PublicationSha256 = $snapshots.Publication.Sha256
    }
}

function Write-WorldConfig {
    param(
        [Parameter(Mandatory)] [ValidateSet('syncing', 'starting', 'stopping', 'ready', 'down', 'error')]
        [string]$State,
        [object]$World,
        [object]$Efctl,
        [string]$LastAction
    )

    $value = [ordered]@{
        format = $script:ConfigFormat
        schemaVersion = 1
        state = $State
        build = [int64]$Build
        network = 'localnet'
        updatedAtUtc = [DateTime]::UtcNow.ToString('o')
        sourceWorkspace = $SourceRoot
    }
    if (-not [string]::IsNullOrWhiteSpace($LastAction)) {
        $value.lastAction = $LastAction
    }
    if ($null -ne $Efctl) {
        $value.efctl = [ordered]@{
            path = [string]$Efctl.Path
            version = [string]$Efctl.Version
        }
    }
    if ($null -ne $World) {
        $value.syncedAtUtc = [DateTime]::UtcNow.ToString('o')
        $value.chainId = [string]$World.ChainId
        $value.world = [ordered]@{
            packageId = [string]$World.PackageId
            objectRegistryId = [string]$World.ObjectRegistryId
            adminAclId = [string]$World.AdminAclId
        }
        $value.adminPrivateKey = [string]$World.AdminPrivateKey
        $value.artifacts = [ordered]@{
            deploymentSha256 = [string]$World.DeploymentSha256
            publicationSha256 = [string]$World.PublicationSha256
        }
    }

    if ($DryRun) {
        Write-Output "[evejs-frontier-world] Would write state '$State' to $WorldConfigPath"
        return
    }
    New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
    $jsonLines = (($value | ConvertTo-Json -Depth 8) -split '\r?\n')
    Write-FrontierPrivateLinesAtomic -Path $WorldConfigPath -Lines $jsonLines
}

function Publish-WorldSync {
    param(
        [object]$Efctl,
        [string]$LastAction = 'sync'
    )

    Assert-DockerWorkspaceOwnership
    $world = Read-SourceWorld
    Write-Output "[evejs-frontier-world] Source: $WorldContractsRoot"
    Write-Output "[evejs-frontier-world] Chain: $($world.ChainId)"
    Write-Output "[evejs-frontier-world] World package: $($world.PackageId)"
    Write-Output "[evejs-frontier-world] Object registry: $($world.ObjectRegistryId)"
    Write-Output "[evejs-frontier-world] Admin ACL: $($world.AdminAclId)"
    Write-WorldConfig -State ready -World $world -Efctl $Efctl -LastAction $LastAction
    if (-not $DryRun) {
        Write-Output "[evejs-frontier-world] Synced private EveJS config: $WorldConfigPath"
    }
}

function Show-SyncStatus {
    if (-not (Test-Path -LiteralPath $WorldConfigPath -PathType Leaf)) {
        Write-Output "[evejs-frontier-world] EveJS sync: absent ($WorldConfigPath)"
        return
    }
    try {
        $config = Get-Content -LiteralPath $WorldConfigPath -Raw | ConvertFrom-Json
    }
    catch {
        throw "Synchronized world config is malformed: $WorldConfigPath"
    }
    if ([string]$config.format -ne $script:ConfigFormat) {
        throw "Synchronized world config has an unsupported format: $WorldConfigPath"
    }
    Write-Output "[evejs-frontier-world] EveJS sync state: $($config.state)"
    Write-Output "[evejs-frontier-world] EveJS sync build: $($config.build)"
    if ($null -ne $config.PSObject.Properties['chainId']) {
        Write-Output "[evejs-frontier-world] EveJS sync chain: $($config.chainId)"
    }
    if ($null -ne $config.PSObject.Properties['world']) {
        Write-Output "[evejs-frontier-world] EveJS world package: $($config.world.packageId)"
    }
}

function Set-LifecycleState {
    param(
        [Parameter(Mandatory)] [ValidateSet('syncing', 'starting', 'stopping', 'down', 'error')]
        [string]$State,
        [Parameter(Mandatory)] [object]$Efctl,
        [Parameter(Mandatory)] [string]$LastAction
    )
    Write-WorldConfig -State $State -Efctl $Efctl -LastAction $LastAction
}

$operationLock = $null
$resultExitCode = 0
try {
    Assert-SourceWorkspace
    $forwardedArguments = @(Get-EfctlForwardArguments -Action $Command)
    $efctl = Resolve-Efctl
    $operationLock = Enter-WorldOperationLock
    Write-Output "[evejs-frontier-world] efctl: $($efctl.Path) ($($efctl.Version))"
    switch ($Command) {
        'sync' {
            Set-LifecycleState -State syncing -Efctl $efctl -LastAction 'sync'
            try {
                Publish-WorldSync -Efctl $efctl -LastAction 'sync'
            }
            catch {
                if (-not $DryRun) {
                    Set-LifecycleState -State error -Efctl $efctl -LastAction 'sync'
                }
                throw
            }
        }
        'up' {
            Set-LifecycleState -State starting -Efctl $efctl -LastAction 'up'
            try {
                Invoke-EfctlEnvironment `
                    -Action up `
                    -Efctl $efctl `
                    -ForwardedArguments $forwardedArguments
                if (-not $DryRun) {
                    Publish-WorldSync -Efctl $efctl -LastAction 'up'
                }
                else {
                    Write-Output "[evejs-frontier-world] Would validate localhost:9000 and publish $WorldConfigPath after efctl succeeds."
                }
            }
            catch {
                if (-not $DryRun) {
                    Set-LifecycleState -State error -Efctl $efctl -LastAction 'up'
                }
                throw
            }
        }
        'down' {
            Set-LifecycleState -State stopping -Efctl $efctl -LastAction 'down'
            try {
                Invoke-EfctlEnvironment `
                    -Action down `
                    -Efctl $efctl `
                    -ForwardedArguments $forwardedArguments
                Set-LifecycleState -State down -Efctl $efctl -LastAction 'down'
            }
            catch {
                if (-not $DryRun) {
                    Set-LifecycleState -State error -Efctl $efctl -LastAction 'down'
                }
                throw
            }
        }
        'restart' {
            Set-LifecycleState -State stopping -Efctl $efctl -LastAction 'restart'
            try {
                $restartDownArguments = @($forwardedArguments | Where-Object {
                    $_ -ceq '--debug'
                })
                Invoke-EfctlEnvironment `
                    -Action down `
                    -Efctl $efctl `
                    -ForwardedArguments $restartDownArguments
                Set-LifecycleState -State starting -Efctl $efctl -LastAction 'restart'
                Invoke-EfctlEnvironment `
                    -Action up `
                    -Efctl $efctl `
                    -ForwardedArguments $forwardedArguments
                if (-not $DryRun) {
                    Publish-WorldSync -Efctl $efctl -LastAction 'restart'
                }
                else {
                    Write-Output "[evejs-frontier-world] Would validate localhost:9000 and publish $WorldConfigPath after efctl succeeds."
                }
            }
            catch {
                if (-not $DryRun) {
                    Set-LifecycleState -State error -Efctl $efctl -LastAction 'restart'
                }
                throw
            }
        }
        'status' {
            Invoke-EfctlEnvironment `
                -Action status `
                -Efctl $efctl `
                -ForwardedArguments $forwardedArguments
            if (-not $DryRun) {
                Show-SyncStatus
            }
        }
    }
}
catch {
    [Console]::Error.WriteLine("[evejs-frontier-world] $($_.Exception.Message)")
    $resultExitCode = 1
}
finally {
    if ($null -ne $operationLock) {
        try {
            $operationLock.ReleaseMutex()
        }
        finally {
            $operationLock.Dispose()
        }
    }
}
exit $resultExitCode
