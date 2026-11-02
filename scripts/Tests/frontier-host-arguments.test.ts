import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const probe = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", "exit 0"]);

test("background native arguments preserve spaces, quotes, Unicode and trailing backslashes", { skip: !!probe.error || probe.status !== 0 }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontier arguments with spaces "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, "print arguments.mjs");
  const output = path.join(root, "stdout.json");
  fs.writeFileSync(script, "console.log(JSON.stringify(process.argv.slice(2)))");
  const values = ["/remotefilecachefolder=C:\\Frontier Client\\ResFiles", "", 'literal"quote', "trailing\\", "résumé 世界", "a\\\"b", "multiple\\\\"];
  const result = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference = 'Stop'
    $ast = [Management.Automation.Language.Parser]::ParseFile($env:FRONTIER_ARGUMENT_SCRIPT, [ref]$null, [ref]$null)
    $function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'ConvertTo-FrontierNativeArgument' }, $true)
    Invoke-Expression $function.Extent.Text
    $values = @($env:FRONTIER_ARGUMENT_VALUES | ConvertFrom-Json)
    $native = @(@($env:FRONTIER_ARGUMENT_FIXTURE) + $values | ForEach-Object { ConvertTo-FrontierNativeArgument $_ })
    $process = Start-Process -FilePath $env:FRONTIER_ARGUMENT_NODE -ArgumentList $native -Wait -PassThru -RedirectStandardOutput $env:FRONTIER_ARGUMENT_OUTPUT
    exit $process.ExitCode
  `], { encoding: "utf8", timeout: 15000, env: { ...process.env,
    FRONTIER_ARGUMENT_SCRIPT: path.resolve(__dirname, "../../PlayFrontier.ps1"), FRONTIER_ARGUMENT_VALUES: JSON.stringify(values),
    FRONTIER_ARGUMENT_FIXTURE: script, FRONTIER_ARGUMENT_OUTPUT: output, FRONTIER_ARGUMENT_NODE: process.execPath,
  } });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8").replace(/^\uFEFF/, "")), values);
});

test("client child environment supports PowerShell 7.2 and restores values after failure", { skip: !!probe.error || probe.status !== 0 }, () => {
  const result = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference = 'Stop'
    $ast = [Management.Automation.Language.Parser]::ParseFile($env:FRONTIER_ARGUMENT_SCRIPT, [ref]$null, [ref]$null)
    $function = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-WithFrontierClientEnvironment' }, $true)
    Invoke-Expression $function.Extent.Text
    $env:EVEJS_TEST_CLIENT_ENV = 'original'
    try {
      Invoke-WithFrontierClientEnvironment -Values @{ EVEJS_TEST_CLIENT_ENV = 'child'; 'EVEJS-TEST-ADDED' = 'added' } -Action {
        if ($env:EVEJS_TEST_CLIENT_ENV -ne 'child' -or [Environment]::GetEnvironmentVariable('EVEJS-TEST-ADDED') -ne 'added') { throw 'wrong inherited environment' }
        throw 'expected child failure'
      }
    } catch { if ($_.Exception.Message -ne 'expected child failure') { throw } }
    if ($env:EVEJS_TEST_CLIENT_ENV -ne 'original' -or $null -ne [Environment]::GetEnvironmentVariable('EVEJS-TEST-ADDED')) { throw 'environment was not restored' }
    exit 0
  `], { encoding: "utf8", timeout: 15000, env: { ...process.env, FRONTIER_ARGUMENT_SCRIPT: path.resolve(__dirname, "../../PlayFrontier.ps1") } });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
