#requires -Version 7.0

<#
.SYNOPSIS
Synchronizes the live efctl world into EveJS and manages its Docker localnet.

.DESCRIPTION
The default efctl workspace is this repository. Its pinned world-contracts and
builder-scaffold submodules use the directory names efctl expects. The tool
always resolves efctl.exe from PATH unless -EfctlPath is provided. It never
installs, copies, pins, or updates efctl.

The synchronized EveJS file contains the current localnet world IDs and only
the admin signer needed for character provisioning. It is stored under the
gitignored _local directory with an ACL restricted to the current Windows user.
The versioned deployments/localnet/world-features.v1.json manifest is validated
and synchronized separately without changing base IDs. Historical
npc-deployment.json files are migrated deliberately during sync.

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
    [string]$DappRoot,
    [string]$EfctlPath,
    [switch]$DryRun,

    # Intended for tests or an intentionally remote/nonstandard localnet only.
    [switch]$SkipRpcValidation,
    [switch]$SkipDockerOwnershipCheck,
    # Intended for isolated tests or explicit recovery workflows only.
    [switch]$SkipNpcFactionFunding,
    [switch]$SkipDappSync,

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
if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
    $SourceRoot = $RepoRoot
}
$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
if ([string]::IsNullOrWhiteSpace($DappRoot)) {
    $DappRoot = Join-Path $RepoRoot 'smart-assembly-control'
}
$DappRoot = [IO.Path]::GetFullPath($DappRoot)
if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
    $DestinationRoot = Join-Path $RepoRoot (Join-Path '_local\frontier-world' $Build)
}
$DestinationRoot = [IO.Path]::GetFullPath($DestinationRoot)
$WorldConfigPath = Join-Path $DestinationRoot 'world.private.json'
$WorldFeaturesConfigPath = Join-Path $DestinationRoot 'world-features.v1.json'
$LegacyNpcConfigPath = Join-Path $DestinationRoot 'npc-deployment.json'
$ArchivedLegacyNpcConfigPath = Join-Path $DestinationRoot 'npc-deployment.legacy.json'
$EfctlConfigPath = Join-Path $SourceRoot 'efctl.yaml'
$WorldContractsRoot = Join-Path $SourceRoot 'world-contracts'
$AssemblyEnergyConfigPath = Join-Path $WorldContractsRoot 'config\assembly-energy.json'
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
        throw "World-contracts checkout is missing: $WorldContractsRoot. Run git submodule update --init --recursive."
    }
    if (Test-SamePath -Left $SourceRoot -Right $RepoRoot) {
        $builderScaffoldRoot = Join-Path $SourceRoot 'builder-scaffold'
        if (-not (Test-Path -LiteralPath $builderScaffoldRoot -PathType Container)) {
            throw "Builder-scaffold checkout is missing: $builderScaffoldRoot. Run git submodule update --init --recursive."
        }
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
    $mountSource = [string]$worldMount.Source
    if ($mountSource -match '^/(?:run/desktop/mnt/host|host_mnt)/([a-zA-Z])/(.+)$') {
        $mountSource = '{0}:\{1}' -f $matches[1].ToUpperInvariant(), $matches[2].Replace('/', '\')
    }
    if (-not (Test-SamePath -Left $mountSource -Right $WorldContractsRoot)) {
        throw (
            "The existing sui-playground container belongs to '$mountSource', not '$WorldContractsRoot'. " +
            'Stop it from its original efctl workspace before switching workspaces.'
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
        [Parameter(Mandatory)] [string]$EnvironmentPath,
        [Parameter(Mandatory)] [string]$AssemblyEnergyPath,
        [Parameter(Mandatory)] [string]$FeatureDeploymentPath
    )

    $paths = [ordered]@{
        Deployment = $DeploymentPath
        Publication = $PublicationPath
        Environment = $EnvironmentPath
        AssemblyEnergy = $AssemblyEnergyPath
        FeatureDeployment = $FeatureDeploymentPath
    }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $first = @{}
        $second = @{}
        foreach ($entry in $paths.GetEnumerator()) {
            $first[$entry.Key] = if ($entry.Key -eq 'FeatureDeployment' -and
                -not (Test-Path -LiteralPath $entry.Value)) { $null }
                else { Read-TextFileSnapshot -Path $entry.Value }
        }
        Start-Sleep -Milliseconds 20
        foreach ($entry in $paths.GetEnumerator()) {
            $second[$entry.Key] = if ($entry.Key -eq 'FeatureDeployment' -and
                -not (Test-Path -LiteralPath $entry.Value)) { $null }
                else { Read-TextFileSnapshot -Path $entry.Value }
        }
        $stable = $true
        foreach ($entry in $paths.GetEnumerator()) {
            if (($null -eq $first[$entry.Key]) -ne ($null -eq $second[$entry.Key]) -or
                ($null -ne $first[$entry.Key] -and
                    $first[$entry.Key].Sha256 -cne $second[$entry.Key].Sha256)) {
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

function Read-AssemblyEnergyManifest {
    param([Parameter(Mandatory)] [object]$Snapshot)

    try {
        $manifest = ConvertFrom-Json -InputObject $Snapshot.Text -AsHashtable
    }
    catch {
        throw "Assembly energy configuration is malformed JSON: $AssemblyEnergyConfigPath"
    }
    if ($manifest -isnot [Collections.IDictionary] -or
        $manifest.schemaVersion -isnot [long] -or $manifest.schemaVersion -ne 1 -or
        $manifest.clientBuild -isnot [long] -or $manifest.clientBuild -ne [long]$Build -or
        $manifest.assemblies -isnot [array] -or $manifest.assemblies.Count -eq 0) {
        throw 'Assembly energy configuration has an unsupported schema, build, or empty catalog.'
    }
    $seen = [Collections.Generic.HashSet[long]]::new()
    [long]$previousTypeID = 0
    $entries = [Collections.Generic.List[object]]::new()
    foreach ($entry in $manifest.assemblies) {
        if ($entry -isnot [Collections.IDictionary] -or
            $entry.typeID -isnot [long] -or $entry.typeID -le 0 -or
            $entry.typeID -le $previousTypeID -or -not $seen.Add([long]$entry.typeID) -or
            $entry.energyRequired -isnot [long] -or $entry.energyRequired -lt 0 -or
            $entry.energyRequired -gt 9007199254740991 -or
            $entry.name -isnot [string] -or [string]::IsNullOrWhiteSpace($entry.name) -or
            $entry.name -match '[\x00-\x1f\x7f]') {
            throw 'Assembly energy configuration contains an invalid, duplicate, or unsorted entry.'
        }
        $previousTypeID = [long]$entry.typeID
        $entries.Add([ordered]@{
            typeID = [long]$entry.typeID
            energyRequired = [long]$entry.energyRequired
        })
    }
    return [pscustomobject]@{
        SchemaVersion = 1
        ClientBuild = [long]$manifest.clientBuild
        Entries = $entries.ToArray()
        Sha256 = [string]$Snapshot.Sha256
    }
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
    if ($Value -notmatch '^0x[0-9a-fA-F]{64}$' -or
        $Value -ceq ('0x' + ('0' * 64))) {
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
    $worldFeaturesPath = Join-Path $WorldContractsRoot 'deployments\localnet\world-features.v1.json'
    $legacyNpcDeploymentPath = Join-Path $WorldContractsRoot 'deployments\localnet\npc-deployment.json'
    $featureDeploymentPath = if (Test-Path -LiteralPath $worldFeaturesPath -PathType Leaf) {
        $worldFeaturesPath
    } else {
        $legacyNpcDeploymentPath
    }
    foreach ($required in @($deploymentPath, $publicationPath, $environmentPath, $AssemblyEnergyConfigPath)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "Required deployed-world artifact is missing: $required"
        }
    }

    $snapshots = Read-StableSourceSnapshots `
        -DeploymentPath $deploymentPath `
        -PublicationPath $publicationPath `
        -EnvironmentPath $environmentPath `
        -AssemblyEnergyPath $AssemblyEnergyConfigPath `
        -FeatureDeploymentPath $featureDeploymentPath
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

    $worldFeatures = Read-WorldFeatureDeployment -Snapshot $snapshots.FeatureDeployment `
        -ChainId $chainId -PackageId $packageId `
        -ObjectRegistryId $objectRegistryId -AdminAclId $adminAclId
    $assemblyEnergy = Read-AssemblyEnergyManifest -Snapshot $snapshots.AssemblyEnergy

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
        AssemblyEnergy = $assemblyEnergy
        WorldFeatures = $worldFeatures
    }
}

function Read-StableFactionFeatureFile {
    param(
        [Parameter(Mandatory)] [string]$ManifestDirectory,
        [Parameter(Mandatory)] [object]$RelativePath,
        [Parameter(Mandatory)] [string]$ExpectedPath,
        [Parameter(Mandatory)] [string]$Label
    )

    if ($RelativePath -isnot [string] -or $RelativePath -cne $ExpectedPath) {
        throw "$Label must use canonical path $ExpectedPath."
    }
    $resolved = [IO.Path]::GetFullPath((Join-Path $ManifestDirectory ($ExpectedPath.Replace('/', '\'))))
    $factionRoot = [IO.Path]::GetFullPath((Join-Path $ManifestDirectory 'factions')) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($factionRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label escapes the faction config directory."
    }
    $item = Get-Item -LiteralPath $resolved -Force -ErrorAction SilentlyContinue
    if ($null -eq $item -or $item.PSIsContainer -or
        ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "$Label is missing or is not a regular file."
    }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $first = Read-TextFileSnapshot -Path $resolved
        Start-Sleep -Milliseconds 20
        $second = Read-TextFileSnapshot -Path $resolved
        if ($first.Sha256 -ceq $second.Sha256) {
            try { $raw = ConvertFrom-Json -InputObject $second.Text -AsHashtable }
            catch { throw "$Label is malformed JSON." }
            if ($raw -isnot [Collections.IDictionary] -or
                $raw['format'] -cne 'eve-frontier-faction-features' -or
                $raw['schemaVersion'] -isnot [long] -or $raw['schemaVersion'] -ne 1) {
                throw "$Label has an unsupported schema."
            }
            return $raw
        }
    }
    throw "$Label is changing; wait for the writer to finish and retry."
}

function Get-WorldFeatureCapabilityNames {
    param(
        [Parameter(Mandatory)] [object]$Value,
        [Parameter(Mandatory)] [Collections.IDictionary]$FeatureSpecs,
        [Parameter(Mandatory)] [Collections.IDictionary]$Capabilities,
        [Parameter(Mandatory)] [string]$Label
    )
    if ($Value -isnot [object[]]) {
        throw "$Label must be an array of capability names."
    }
    $names = [Collections.Generic.List[string]]::new()
    foreach ($name in $Value) {
        if ($name -isnot [string] -or -not $FeatureSpecs.Contains($name) -or
            -not $Capabilities.Contains($name) -or
            $Capabilities[$name]['status'] -cne 'deployed') {
            throw "$Label contains an unavailable capability."
        }
        if (-not $names.Contains($name)) { $names.Add($name) }
    }
    return ,@($names | Sort-Object)
}

function Read-WorldFeatureDeployment {
    param(
        [AllowNull()] [object]$Snapshot,
        [Parameter(Mandatory)] [string]$ChainId,
        [Parameter(Mandatory)] [string]$PackageId,
        [Parameter(Mandatory)] [string]$ObjectRegistryId,
        [Parameter(Mandatory)] [string]$AdminAclId
    )

    if ($null -eq $Snapshot) { return $null }
    try {
        $manifest = ConvertFrom-Json -InputObject $Snapshot.Text -AsHashtable
    }
    catch {
        throw 'World feature deployment metadata is malformed JSON.'
    }
    if ($manifest -isnot [Collections.IDictionary]) {
        throw 'World feature deployment metadata has an unsupported schema.'
    }
    $manifestChainId = $manifest['chainId']
    if ($manifestChainId -isnot [string] -or
        $manifestChainId -cnotmatch '^[0-9a-fA-F]+$' -or
        $manifestChainId.ToLowerInvariant() -cne $ChainId) {
        throw 'World feature deployment chainId does not match the synchronized world.'
    }

    $featureSpecs = [ordered]@{
        npc = @('packageId', 'typeOrigin', 'npcRegistryId')
        assemblyAccess = @('accessPackageId', 'accessTypeOrigin', 'accessRegistryId')
        catapult = @('catapultPackageId', 'catapultTypeOrigin', 'catapultRegistryId')
        smartIndustry = @('industryPackageId', 'industryTypeOrigin', 'industryRegistryId')
        transponder = @('transponderPackageId', 'transponderTypeOrigin', 'transponderRegistryId')
        actionQueue = @('actionPackageId', 'actionTypeOrigin', 'actionRegistryId')
        industryActions = @('industryActionsPackageId', 'industryActionsTypeOrigin', 'industryActionsRegistryId')
        logisticsActions = @('logisticsPackageId', 'logisticsTypeOrigin', 'logisticsRegistryId')
        infrastructureActions = @('infrastructurePackageId', 'infrastructureTypeOrigin', 'infrastructureRegistryId')
        automation = @('automationPackageId', 'automationTypeOrigin', 'automationRegistryId')
    }
    $capabilities = [ordered]@{}
    $migration = $null
    $manifestFormat = $manifest['format']
    $manifestSchemaVersion = $manifest['schemaVersion']
    if ($manifestFormat -ceq 'eve-frontier-world-features' -and
        $manifestSchemaVersion -is [long] -and
        $manifestSchemaVersion -eq 1) {
        if ($manifest['world'] -isnot [Collections.IDictionary] -or
            $manifest['capabilities'] -isnot [Collections.IDictionary]) {
            throw 'World feature manifest world/capabilities records are invalid.'
        }
        $worldRecord = $manifest['world']
        foreach ($name in $manifest['capabilities'].Keys) {
            if (-not $featureSpecs.Contains($name)) {
                throw "World feature manifest contains unknown capability '$name'."
            }
            $record = $manifest['capabilities'][$name]
            if ($record -isnot [Collections.IDictionary] -or
                $record['status'] -cnotin @('deployed', 'unavailable')) {
                throw "World feature capability '$name' has an invalid status."
            }
            if ($record['status'] -ceq 'unavailable') {
                $capabilities[$name] = [ordered]@{ status = 'unavailable' }
                continue
            }
            $capabilities[$name] = [ordered]@{
                status = 'deployed'
                packageId = Assert-SuiAddress -Value ([string]$record['packageId']) -Label "$name package"
                typeOrigin = Assert-SuiAddress -Value ([string]$record['typeOrigin']) -Label "$name type origin"
                registryId = Assert-SuiAddress -Value ([string]$record['registryId']) -Label "$name registry"
            }
        }
    }
    elseif ($manifestSchemaVersion -is [long] -and
        $manifestSchemaVersion -in @(1, 2, 3)) {
        $worldRecord = [ordered]@{
            packageId = $manifest['worldPackageId']
            objectRegistryId = $manifest['objectRegistryId']
            adminAclId = $manifest['adminAclId']
        }
        $legacy = @{} + $manifest
        if ($manifestSchemaVersion -lt 2) {
            $legacy.actionPackageId = $legacy.accessPackageId
            $legacy.actionTypeOrigin = $legacy.accessTypeOrigin
            $legacy.actionRegistryId = $legacy.accessRegistryId
            $legacy.industryActionsPackageId = $legacy.industryPackageId
            $legacy.industryActionsTypeOrigin = $legacy.industryTypeOrigin
            $legacy.industryActionsRegistryId = $legacy.industryRegistryId
        }
        if ($manifestSchemaVersion -lt 3) {
            foreach ($prefix in @('logistics', 'infrastructure', 'automation')) {
                $legacy["${prefix}PackageId"] = $legacy.actionPackageId
                $legacy["${prefix}TypeOrigin"] = $legacy.actionTypeOrigin
                $legacy["${prefix}RegistryId"] = $legacy.actionRegistryId
            }
        }
        $incomplete = [Collections.Generic.List[string]]::new()
        foreach ($entry in $featureSpecs.GetEnumerator()) {
            $values = @($entry.Value | ForEach-Object { $legacy[$_] })
            if (@($values | Where-Object { $null -ne $_ -and $_ -isnot [string] }).Count -gt 0) {
                throw "Legacy feature capability '$($entry.Key)' contains non-string address metadata."
            }
            $present = @($values | Where-Object { $_ -is [string] -and $_.Length -gt 0 }).Count
            if ($present -eq 0) { continue }
            if ($present -ne 3) {
                $incomplete.Add([string]$entry.Key)
                continue
            }
            $capabilities[$entry.Key] = [ordered]@{
                status = 'deployed'
                packageId = Assert-SuiAddress -Value ([string]$values[0]) -Label "$($entry.Key) package"
                typeOrigin = Assert-SuiAddress -Value ([string]$values[1]) -Label "$($entry.Key) type origin"
                registryId = Assert-SuiAddress -Value ([string]$values[2]) -Label "$($entry.Key) registry"
            }
        }
        $migration = [ordered]@{
            source = 'npc-deployment.json'
            sourceSchemaVersion = [long]$manifestSchemaVersion
            incompleteCapabilities = @($incomplete | Sort-Object)
        }
    }
    else {
        throw 'World feature deployment metadata has an unsupported schema.'
    }

    $world = [ordered]@{
        packageId = Assert-SuiAddress -Value ([string]$worldRecord['packageId']) -Label 'Feature manifest world package'
        objectRegistryId = Assert-SuiAddress -Value ([string]$worldRecord['objectRegistryId']) -Label 'Feature manifest ObjectRegistry'
        adminAclId = Assert-SuiAddress -Value ([string]$worldRecord['adminAclId']) -Label 'Feature manifest AdminACL'
    }
    $expected = @{ packageId = $PackageId; objectRegistryId = $ObjectRegistryId; adminAclId = $AdminAclId }
    foreach ($field in $expected.Keys) {
        if ($world[$field] -cne $expected[$field]) {
            throw "World feature deployment $field does not match the synchronized world."
        }
    }
    $validated = [ordered]@{
        format = 'eve-frontier-world-features'
        schemaVersion = 1
        chainId = $ChainId
        world = $world
        capabilities = $capabilities
    }
    $factionFiles = [ordered]@{}
    $splitFactionConfig = $manifest['factionConfig']
    $factionRecords = $manifest['factions']
    if ($null -ne $splitFactionConfig) {
        if ($null -ne $factionRecords) {
            throw 'World feature manifest cannot combine factionConfig with inline factions.'
        }
        if ($splitFactionConfig -isnot [Collections.IDictionary] -or
            $splitFactionConfig['default'] -isnot [Collections.IDictionary] -or
            $splitFactionConfig['factions'] -isnot [Collections.IDictionary] -or
            $splitFactionConfig['default']['id'] -cne 'default') {
            throw 'World feature factionConfig requires default and factions records.'
        }
        $manifestDirectory = Split-Path -Parent ([string]$Snapshot.Path)
        $defaultPath = 'factions/default.v1.json'
        $defaultFile = Read-StableFactionFeatureFile `
            -ManifestDirectory $manifestDirectory `
            -RelativePath $splitFactionConfig['default']['path'] `
            -ExpectedPath $defaultPath `
            -Label 'Default faction feature config'
        if ($defaultFile['configId'] -cne 'default') {
            throw 'Default faction feature config must use configId default.'
        }
        $defaultCapabilities = Get-WorldFeatureCapabilityNames `
            -Value $defaultFile['capabilities'] `
            -FeatureSpecs $featureSpecs -Capabilities $capabilities `
            -Label 'Default faction feature config capabilities'
        $factionFiles[$defaultPath] = [ordered]@{
            format = 'eve-frontier-faction-features'
            schemaVersion = 1
            configId = 'default'
            capabilities = $defaultCapabilities
        }
        $validatedReferences = [ordered]@{}
        foreach ($factionKey in @($splitFactionConfig['factions'].Keys | Sort-Object)) {
            $reference = $splitFactionConfig['factions'][$factionKey]
            $factionKeyMatch = [regex]::Match($factionKey, '^(\d{1,10})-[a-z0-9][a-z0-9_-]{0,95}$')
            if (-not $factionKeyMatch.Success -or
                [uint64]$factionKeyMatch.Groups[1].Value -gt [uint32]::MaxValue -or
                $reference -isnot [Collections.IDictionary] -or
                $reference['fallback'] -cne 'default') {
                throw 'World feature faction references must use factionID-factionStringOnlyID and fallback default.'
            }
            $relativePath = "factions/$factionKey.v1.json"
            $factionFile = Read-StableFactionFeatureFile `
                -ManifestDirectory $manifestDirectory `
                -RelativePath $reference['path'] `
                -ExpectedPath $relativePath `
                -Label "Faction feature config $factionKey"
            if ($factionFile['factionKey'] -cne $factionKey -or
                $factionFile['fallback'] -cne 'default') {
                throw "Faction feature config $factionKey has mismatched identity or fallback."
            }
            $validatedFactionFile = [ordered]@{
                format = 'eve-frontier-faction-features'
                schemaVersion = 1
                factionKey = $factionKey
                fallback = 'default'
            }
            if ($factionFile.Contains('capabilities')) {
                $validatedFactionFile.capabilities = Get-WorldFeatureCapabilityNames `
                    -Value $factionFile['capabilities'] `
                    -FeatureSpecs $featureSpecs -Capabilities $capabilities `
                    -Label "Faction feature config $factionKey capabilities"
            }
            $factionFiles[$relativePath] = $validatedFactionFile
            $validatedReferences[$factionKey] = [ordered]@{
                path = $relativePath
                fallback = 'default'
            }
        }
        $validated.factionConfig = [ordered]@{
            default = [ordered]@{ id = 'default'; path = $defaultPath }
            factions = $validatedReferences
        }
    }
    elseif ($null -ne $factionRecords) {
        if ($factionRecords -isnot [Collections.IDictionary]) {
            throw 'World feature manifest factions must be an object.'
        }
        $validatedFactions = [ordered]@{}
        foreach ($factionKey in @($factionRecords.Keys | Sort-Object)) {
            $record = $factionRecords[$factionKey]
            $factionKeyMatch = [regex]::Match($factionKey, '^(\d{1,10})-[a-z0-9][a-z0-9_-]{0,95}$')
            if (-not $factionKeyMatch.Success -or
                [uint64]$factionKeyMatch.Groups[1].Value -gt [uint32]::MaxValue -or
                $record -isnot [Collections.IDictionary] -or
                $record['capabilities'] -isnot [object[]]) {
                throw 'World feature faction records must use factionID-factionStringOnlyID and a capabilities array.'
            }
            $enabled = [Collections.Generic.List[string]]::new()
            foreach ($capabilityName in $record['capabilities']) {
                if ($capabilityName -isnot [string] -or
                    -not $featureSpecs.Contains($capabilityName) -or
                    -not $capabilities.Contains($capabilityName) -or
                    $capabilities[$capabilityName]['status'] -cne 'deployed') {
                    throw "World feature faction '$factionKey' enables an unavailable capability."
                }
                if (-not $enabled.Contains($capabilityName)) { $enabled.Add($capabilityName) }
            }
            $validatedFactions[$factionKey] = [ordered]@{
                capabilities = @($enabled | Sort-Object)
            }
        }
        $validated.factions = $validatedFactions
    }
    if ($null -ne $migration) { $validated.migration = $migration }
    return [pscustomobject]@{
        Manifest = $validated
        FactionFiles = $factionFiles
    }
}

function Publish-WorldFeatureDeployment {
    param([AllowNull()] [object]$Deployment)

    $exists = Test-Path -LiteralPath $WorldFeaturesConfigPath
    $legacyExists = Test-Path -LiteralPath $LegacyNpcConfigPath
    if ($null -eq $Deployment) {
        if ($exists -or $legacyExists) {
            # This may be operator-managed metadata or an older upgrade. Keep it
            # recoverable, but never mark a base world ready with stale settings.
            throw 'World feature source is absent but synchronized feature metadata exists; reconcile it before syncing.'
        }
        return
    }
    $Manifest = $Deployment.Manifest
    $FactionFiles = $Deployment.FactionFiles
    if ($exists) {
        $existing = Get-Item -LiteralPath $WorldFeaturesConfigPath -Force
        if ($existing.PSIsContainer -or
            ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Refusing to replace a non-file or reparse-point world-feature destination.'
        }
    }
    if ($legacyExists -and (Test-Path -LiteralPath $ArchivedLegacyNpcConfigPath)) {
        throw 'Both npc-deployment.json and npc-deployment.legacy.json exist; reconcile the legacy migration before syncing.'
    }
    if ($DryRun) {
        Write-Output "[evejs-frontier-world] Would sync public feature deployment: $WorldFeaturesConfigPath"
        if ($legacyExists) {
            Write-Output "[evejs-frontier-world] Would archive legacy feature deployment: $ArchivedLegacyNpcConfigPath"
        }
        if ($FactionFiles.Count -gt 0) {
            Write-Output "[evejs-frontier-world] Would sync $($FactionFiles.Count) faction feature configuration files."
        }
        return
    }
    New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
    foreach ($relativePath in @($FactionFiles.Keys | Sort-Object)) {
        $destinationPath = Join-Path $DestinationRoot ($relativePath.Replace('/', '\'))
        New-Item -ItemType Directory -Path (Split-Path -Parent $destinationPath) -Force | Out-Null
        Write-FrontierJsonAtomic -Path $destinationPath -Value $FactionFiles[$relativePath]
    }
    Write-FrontierJsonAtomic -Path $WorldFeaturesConfigPath -Value $Manifest
    if ($legacyExists) {
        Move-Item -LiteralPath $LegacyNpcConfigPath -Destination $ArchivedLegacyNpcConfigPath
        Write-Output "[evejs-frontier-world] Archived historical feature manifest: $ArchivedLegacyNpcConfigPath"
    }
    $capabilityNames = @($Manifest.capabilities.Keys | Sort-Object) -join ', '
    Write-Output "[evejs-frontier-world] Synced world feature capabilities: $capabilityNames"
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
        $value.assemblyEnergy = [ordered]@{
            schemaVersion = [long]$World.AssemblyEnergy.SchemaVersion
            clientBuild = [long]$World.AssemblyEnergy.ClientBuild
            entries = @($World.AssemblyEnergy.Entries)
        }
        $value.adminPrivateKey = [string]$World.AdminPrivateKey
        $value.artifacts = [ordered]@{
            deploymentSha256 = [string]$World.DeploymentSha256
            publicationSha256 = [string]$World.PublicationSha256
            assemblyEnergySha256 = [string]$World.AssemblyEnergy.Sha256
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
    Publish-WorldFeatureDeployment -Deployment $world.WorldFeatures
    Write-Output "[evejs-frontier-world] Source: $WorldContractsRoot"
    Write-Output "[evejs-frontier-world] Chain: $($world.ChainId)"
    Write-Output "[evejs-frontier-world] World package: $($world.PackageId)"
    Write-Output "[evejs-frontier-world] Object registry: $($world.ObjectRegistryId)"
    Write-Output "[evejs-frontier-world] Admin ACL: $($world.AdminAclId)"
    Write-WorldConfig -State ready -World $world -Efctl $Efctl -LastAction $LastAction
    Invoke-NpcFactionFunding
    Sync-DappConfiguration
    if (-not $DryRun) {
        Write-Output "[evejs-frontier-world] Synced private EveJS config: $WorldConfigPath"
    }
}

function Sync-DappConfiguration {
    if ($SkipDappSync) {
        Write-Output '[evejs-frontier-world] Smart Assembly dApp configuration sync skipped explicitly.'
        return
    }

    $configureScript = Join-Path $DappRoot 'scripts\configure-local.mjs'
    if (-not (Test-Path -LiteralPath $DappRoot -PathType Container) -or
        -not (Test-Path -LiteralPath $configureScript -PathType Leaf)) {
        throw (
            "Smart Assembly dApp checkout is missing or incomplete: $DappRoot. " +
            'Run git submodule update --init --recursive.'
        )
    }
    if ($DryRun) {
        Write-Output (
            '[evejs-frontier-world] Would sync Smart Assembly dApp configuration ' +
            "from $WorldContractsRoot to $DappRoot"
        )
        return
    }

    $node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -eq $node) {
        $node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue |
            Select-Object -First 1
    }
    if ($null -eq $node) {
        throw 'Node.js is required to synchronize the Smart Assembly dApp configuration.'
    }

    Push-Location $DappRoot
    try {
        & $node.Source $configureScript `
            --world-dir $WorldContractsRoot `
            --network localnet `
            --force
        if ($LASTEXITCODE -ne 0) {
            throw "Smart Assembly dApp configuration sync failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
    Write-Output "[evejs-frontier-world] Synced Smart Assembly dApp configuration: $DappRoot"
}

function Invoke-NpcFactionFunding {
    if ($SkipNpcFactionFunding) {
        Write-Output '[evejs-frontier-world] NPC faction wallet funding skipped explicitly.'
        return
    }
    $fundingSource = Join-Path $RepoRoot 'scripts\FrontierWorld\fund-npc-factions.ts'
    $fundingScript = Join-Path $RepoRoot 'scripts\FrontierWorld\fund-npc-factions.js'
    $factionsConfig = Join-Path $RepoRoot 'npc-factions.config.json'
    if (-not (Test-Path -LiteralPath $fundingSource -PathType Leaf) -or
        -not (Test-Path -LiteralPath $factionsConfig -PathType Leaf)) {
        throw 'NPC faction funding source or faction configuration is missing.'
    }
    if ($DryRun) {
        Write-Output "[evejs-frontier-world] Would top up configured NPC faction wallets after writing $WorldConfigPath"
        return
    }
    $npm = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -eq $npm) {
        $npm = Get-Command npm -CommandType Application -ErrorAction SilentlyContinue |
            Select-Object -First 1
    }
    $node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -eq $node) {
        $node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue |
            Select-Object -First 1
    }
    if ($null -eq $npm -or $null -eq $node) {
        throw 'Node.js and npm are required to fund NPC faction wallets during world sync.'
    }
    Push-Location $RepoRoot
    try {
        & $npm.Source run --silent build:tools
        if ($LASTEXITCODE -ne 0) {
            throw "NPC faction funding build failed with exit code $LASTEXITCODE."
        }
        if (-not (Test-Path -LiteralPath $fundingScript -PathType Leaf)) {
            throw "NPC faction funding build did not produce: $fundingScript"
        }
        & $node.Source $fundingScript `
            --world-config $WorldConfigPath `
            --factions-config $factionsConfig
        if ($LASTEXITCODE -ne 0) {
            throw "NPC faction wallet funding failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
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
