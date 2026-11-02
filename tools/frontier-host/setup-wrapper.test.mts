import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const probe = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", "exit 0"]);
const skip = !!probe.error || probe.status !== 0;

function powershell(script: string, env: NodeJS.ProcessEnv = {}) {
  return spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", timeout: 20000, env: { ...process.env, ...env },
  });
}

function fixture(t: { after: (fn: () => void) => void }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontier setup wrapper "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "tools/frontier-client"), { recursive: true });
  fs.mkdirSync(path.join(root, "tools/frontier-host"), { recursive: true });
  fs.copyFileSync(path.join(REPO, "SetupFrontierWindows.ps1"), path.join(root, "SetupFrontierWindows.ps1"));
  fs.writeFileSync(path.join(root, "tools/frontier-host/index.mjs"), `console.log(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));`);
  fs.writeFileSync(path.join(root, "python fixture.ps1"), `if ($args[0] -eq '--version') { 'Python 3.12.0' } else { 'CPython' }; $global:LASTEXITCODE = 0`);
  fs.writeFileSync(path.join(root, "tools/frontier-client/FrontierWindows.Common.psm1"), `
    function Get-FrontierNodePath { $env:FRONTIER_WRAPPER_NODE }
    function Get-FrontierNpmPath { if ($env:FRONTIER_WRAPPER_NPM) { $env:FRONTIER_WRAPPER_NPM } else { $env:FRONTIER_WRAPPER_NODE } }
    function Get-FrontierPython312Path { param($RepoRoot, $PythonPath) $env:FRONTIER_WRAPPER_PYTHON }
    function Invoke-FrontierDiscovery {
      param($RepoRoot, $SourceRoot, $Build)
      if ($Build -ne 0 -and $Build -ne 3640684) { throw 'unexpected build selection' }
      [pscustomobject]@{ metadata = [pscustomobject]@{ build = 3640684; sync = 'fixture' }; buildRoot = $SourceRoot }
    }
    function Get-Command { param($Name, $CommandType, $ErrorAction)
      if ($env:FRONTIER_WRAPPER_GIT -and $Name -eq 'git.exe') { [pscustomobject]@{ Source = $env:FRONTIER_WRAPPER_NODE } }
      else { Microsoft.PowerShell.Core\\Get-Command @PSBoundParameters }
    }
    Export-ModuleMember -Function *
  `);
  return root;
}

test("Windows setup dry-run delegates discovered exact build and all preparation options", { skip }, t => {
  const root = fixture(t);
  const source = path.join(root, "retail client with spaces");
  const stage = path.join(root, "isolated stage");
  const python = path.join(root, "selected Python.exe");
  const result = powershell(`
    $env:OS = 'Windows_NT'
    Remove-Item Env:ProgramFiles -ErrorAction SilentlyContinue
    $beforePath = $env:Path
    $beforeLocation = (Get-Location).Path
    & (Join-Path $env:FRONTIER_WRAPPER_ROOT 'SetupFrontierWindows.ps1') -SourceRoot $env:FRONTIER_WRAPPER_SOURCE -Python $env:FRONTIER_WRAPPER_SELECTED_PYTHON -StagingBase $env:FRONTIER_WRAPPER_STAGE -DryRun -CleanStage -CopyResFiles -SkipStage -SkipDapp -ForceData
    if ($env:Path -ne $beforePath -or (Get-Location).Path -ne $beforeLocation) { throw 'wrapper did not restore caller environment' }
  `, {
    FRONTIER_WRAPPER_ROOT: root, FRONTIER_WRAPPER_NODE: process.execPath,
    FRONTIER_WRAPPER_PYTHON: path.join(root, "python fixture.ps1"), FRONTIER_WRAPPER_SOURCE: source,
    FRONTIER_WRAPPER_STAGE: stage, FRONTIER_WRAPPER_SELECTED_PYTHON: python,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  assert.deepEqual(report, { cwd: root, args: ["setup", "--build", "3640684", "--client-root", source,
    "--python", python, "--dry-run", "--staging-base", stage, "--skip-stage", "--skip-dapp",
    "--clean-stage", "--copy-resfiles", "--force-data"] });
});

test("Windows setup preview never bootstraps missing compiled tools", { skip }, t => {
  const root = fixture(t);
  fs.unlinkSync(path.join(root, "tools/frontier-host/index.mjs"));
  const result = powershell(`
    $env:OS = 'Windows_NT'
    Remove-Item Env:ProgramFiles -ErrorAction SilentlyContinue
    & (Join-Path $env:FRONTIER_WRAPPER_ROOT 'SetupFrontierWindows.ps1') -DryRun
  `, { FRONTIER_WRAPPER_ROOT: root, FRONTIER_WRAPPER_NODE: process.execPath,
    FRONTIER_WRAPPER_PYTHON: path.join(root, "python fixture.ps1") });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Host tools are not compiled/);
  assert.equal(fs.existsSync(path.join(root, "node_modules")), false);
});

test("Windows setup preview refuses stale host code without running it", { skip }, t => {
  const root = fixture(t);
  const entry = path.join(root, "tools/frontier-host/index.mjs");
  fs.writeFileSync(entry, `throw new Error('obsolete host must not run');`);
  const source = path.join(root, "tools/frontier-host/setup.mts");
  const emitted = path.join(root, "tools/frontier-host/setup.mjs");
  fs.writeFileSync(source, "// current shared workflow");
  fs.writeFileSync(emitted, "// obsolete Windows delegate");
  fs.utimesSync(emitted, new Date(1000), new Date(1000));
  fs.utimesSync(source, new Date(2000), new Date(2000));
  const result = powershell(`
    $env:OS = 'Windows_NT'
    Remove-Item Env:ProgramFiles -ErrorAction SilentlyContinue
    & (Join-Path $env:FRONTIER_WRAPPER_ROOT 'SetupFrontierWindows.ps1') -DryRun
  `, { FRONTIER_WRAPPER_ROOT: root, FRONTIER_WRAPPER_NODE: process.execPath,
    FRONTIER_WRAPPER_PYTHON: path.join(root, "python fixture.ps1") });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Host tools are stale/);
  assert.doesNotMatch(result.stderr, /obsolete host must not run/);
  assert.equal(fs.existsSync(path.join(root, "node_modules")), false);
});

for (const compilerPresent of [false, true]) {
  test(`Windows setup rebuilds obsolete host code before delegation (compiler ${compilerPresent ? "present" : "missing"})`, { skip }, t => {
    const root = fixture(t);
    const source = path.join(root, "retail source");
    const compiler = path.join(root, "node_modules/typescript/bin/tsc");
    if (compilerPresent) {
      fs.mkdirSync(path.dirname(compiler), { recursive: true });
      fs.writeFileSync(compiler, "fixture compiler");
    }
    const oldHost = `throw new Error('obsolete host must be rebuilt before execution');`;
    fs.writeFileSync(path.join(root, "tools/frontier-host/index.mjs"), oldHost);
    fs.writeFileSync(path.join(root, "tools/frontier-host/setup.mts"), "// current setup source");
    fs.writeFileSync(path.join(root, "tools/frontier-host/setup.mjs"), "// obsolete recursive setup");
    const npm = path.join(root, "npm fixture.ps1");
    fs.writeFileSync(npm, `
      if ($args -contains '--version') { '10.9.0'; $global:LASTEXITCODE = 0; return }
      $root = $env:FRONTIER_WRAPPER_ROOT
      if ($args -contains 'ci') {
        Add-Content -LiteralPath (Join-Path $root 'workflow.log') -Value 'ci'
        if ($args -notcontains '--ignore-scripts' -or $args -notcontains '--include=dev') { throw 'unsafe compiler bootstrap' }
        New-Item -ItemType Directory -Path (Join-Path $root 'node_modules/typescript/bin') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $root 'node_modules/typescript/bin/tsc') -Value 'fixture compiler'
      }
      elseif ($args -contains 'build:tools') {
        Add-Content -LiteralPath (Join-Path $root 'workflow.log') -Value 'build'
        Set-Content -LiteralPath (Join-Path $root 'tools/frontier-host/index.mjs') -Value $env:FRONTIER_WRAPPER_FRESH_HOST
      }
      else { throw 'unexpected npm call' }
      $global:LASTEXITCODE = 0
    `);
    const log = path.join(root, "workflow.log");
    const freshHost = `import fs from 'node:fs'; fs.appendFileSync(process.env.FRONTIER_WRAPPER_LOG, 'host\\n'); console.log(JSON.stringify(process.argv.slice(2)));`;
    const result = powershell(`
      $env:OS = 'Windows_NT'
      & (Join-Path $env:FRONTIER_WRAPPER_ROOT 'SetupFrontierWindows.ps1') -SourceRoot $env:FRONTIER_WRAPPER_SOURCE -SkipStage -SkipDapp
    `, { FRONTIER_WRAPPER_ROOT: root, FRONTIER_WRAPPER_NODE: process.execPath,
      FRONTIER_WRAPPER_PYTHON: path.join(root, "python fixture.ps1"), FRONTIER_WRAPPER_SOURCE: source,
      FRONTIER_WRAPPER_GIT: "fixture", FRONTIER_WRAPPER_NPM: npm,
      FRONTIER_WRAPPER_FRESH_HOST: freshHost, FRONTIER_WRAPPER_LOG: log });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const phases = fs.readFileSync(log, "utf8").trim().split(/\r?\n/);
    assert.deepEqual(phases, compilerPresent ? ["build", "host"] : ["ci", "build", "host"]);
    assert.doesNotMatch(result.stderr, /obsolete host/);
    assert.deepEqual(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)), ["setup", "--build", "3640684", "--client-root", source,
      "--python", path.join(root, "python fixture.ps1"), "--skip-stage", "--skip-dapp"]);
  });
}

test("Windows setup status discovers once and reports the same build and custom stage", { skip }, t => {
  const root = fixture(t);
  const source = path.join(root, "retail client");
  const stage = path.join(root, "custom stage");
  fs.writeFileSync(path.join(root, "StageFrontierClient.ps1"), `param($SourceRoot, $Build, $StagingBase, [switch]$Status); @{ kind='stage'; build=[string]$Build; source=$SourceRoot; stagingBase=$StagingBase; status=$Status.IsPresent } | ConvertTo-Json -Compress`);
  fs.writeFileSync(path.join(root, "StartFrontierServer.ps1"), `param($Build, [switch]$Status); @{ kind='server'; build=[string]$Build; status=$Status.IsPresent } | ConvertTo-Json -Compress`);
  const result = powershell(`
    $env:OS = 'Windows_NT'
    Remove-Item Env:ProgramFiles -ErrorAction SilentlyContinue
    & (Join-Path $env:FRONTIER_WRAPPER_ROOT 'SetupFrontierWindows.ps1') -SourceRoot $env:FRONTIER_WRAPPER_SOURCE -StagingBase $env:FRONTIER_WRAPPER_STAGE -Status
  `, { FRONTIER_WRAPPER_ROOT: root, FRONTIER_WRAPPER_NODE: process.execPath,
    FRONTIER_WRAPPER_PYTHON: path.join(root, "python fixture.ps1"), FRONTIER_WRAPPER_SOURCE: source, FRONTIER_WRAPPER_STAGE: stage });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const reports = result.stdout.split(/\r?\n/).filter(line => line.startsWith("{") && line.includes('"kind"')).map(line => JSON.parse(line));
  assert.deepEqual(reports, [
    { kind: "stage", build: "3640684", source, stagingBase: stage, status: true },
    { kind: "server", build: "3640684", status: true },
  ]);
});

test("Windows patch compatibility entry point refuses a stage from another selected build", { skip }, t => {
  const root = fixture(t);
  fs.copyFileSync(path.join(REPO, "PatchFrontierClientTrust.ps1"), path.join(root, "PatchFrontierClientTrust.ps1"));
  fs.copyFileSync(path.join(REPO, "tools/frontier-client/FrontierWindows.Common.psm1"), path.join(root, "tools/frontier-client/FrontierWindows.Common.psm1"));
  const stagingBase = path.join(root, "stage");
  const stagePath = path.join(stagingBase, "3502403");
  fs.mkdirSync(stagePath, { recursive: true });
  fs.writeFileSync(path.join(stagePath, ".evejs-frontier-stage.json"), JSON.stringify({
    format: "evejs-frontier-stage-v2", platform: "windows", build: 3502403, stagingBase, stagePath,
  }));
  const result = powershell(`
    $env:OS = 'Windows_NT'
    & (Join-Path $env:FRONTIER_WRAPPER_ROOT 'PatchFrontierClientTrust.ps1') -StagedRoot $env:FRONTIER_WRAPPER_STAGE -Build 3640684 -DryRun
  `, { FRONTIER_WRAPPER_ROOT: root, FRONTIER_WRAPPER_STAGE: stagePath });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /belongs to build 3502403, not 3640684/);
});

test("Windows native Python selection honors explicit and environment overrides and rejects invalid selection", { skip }, t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "valid.ps1"), `'CPython|3.12|64'; $global:LASTEXITCODE = 0`);
  fs.writeFileSync(path.join(root, "invalid.ps1"), `'CPython|3.13|64'; $global:LASTEXITCODE = 0`);
  const result = powershell(`
    $ErrorActionPreference = 'Stop'
    $ast = [Management.Automation.Language.Parser]::ParseFile($env:FRONTIER_WRAPPER_COMMON, [ref]$null, [ref]$null)
    $function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-FrontierPython312Path' }, $true)
    Invoke-Expression $function.Extent.Text
    function Get-Command { param($Name, $CommandType, $ErrorAction)
      if ($Name -eq 'selected-valid') { [pscustomobject]@{ Source = (Join-Path $env:FRONTIER_WRAPPER_ROOT 'valid.ps1') } }
      elseif ($Name -eq 'selected-invalid') { [pscustomobject]@{ Source = (Join-Path $env:FRONTIER_WRAPPER_ROOT 'invalid.ps1') } }
    }
    $env:EVEJS_FRONTIER_NATIVE_PYTHON312 = 'selected-valid'
    $expected = Join-Path $env:FRONTIER_WRAPPER_ROOT 'valid.ps1'
    if ((Get-FrontierPython312Path) -ne $expected) { throw 'environment override ignored' }
    $env:EVEJS_FRONTIER_NATIVE_PYTHON312 = 'selected-invalid'
    if ((Get-FrontierPython312Path -PythonPath 'selected-valid') -ne $expected) { throw 'explicit override ignored' }
    try { Get-FrontierPython312Path | Out-Null; throw 'invalid interpreter accepted' }
    catch { if ($_.Exception.Message -notmatch 'not CPython 3.12 x64') { throw } }
    try { Get-FrontierPython312Path -PythonPath 'missing' | Out-Null; throw 'missing interpreter accepted' }
    catch { if ($_.Exception.Message -notmatch 'was not found') { throw } }
    exit 0
  `, { FRONTIER_WRAPPER_ROOT: root, FRONTIER_WRAPPER_COMMON: path.join(REPO, "tools/frontier-client/FrontierWindows.Common.psm1") });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("Windows setup and patch compatibility entry points parse", { skip }, () => {
  const result = powershell(`
    foreach ($file in @('SetupFrontierWindows.ps1', 'PatchFrontierClientTrust.ps1', 'tools/frontier-client/FrontierWindows.Common.psm1')) {
      $tokens=$null; $errors=$null
      [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $env:FRONTIER_WRAPPER_REPO $file), [ref]$tokens, [ref]$errors)
      if ($errors.Count) { throw ($errors.Message -join '; ') }
    }
  `, { FRONTIER_WRAPPER_REPO: REPO });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
