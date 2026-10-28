import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { assertNoSymlink } from "./config.mjs";

const require = createRequire(import.meta.url);
const GATEWAY_NAMES = ["app.launchdarkly.com", "clientstream.launchdarkly.com", "clientsdk.launchdarkly.com", "dev-public-gateway.evetech.net", "events.launchdarkly.com", "public-gateway.evetech.net", "stream.launchdarkly.com", "localhost"];

export function certificatePaths(repoRoot: string) {
  return {
    ca: path.join(repoRoot, "server/certs/xmpp-ca-cert.pem"),
    caKey: path.join(repoRoot, "server/certs/xmpp-ca-key.pem"),
    xmpp: path.join(repoRoot, "server/certs/xmpp-dev-cert.pem"),
    xmppKey: path.join(repoRoot, "server/certs/xmpp-dev-key.pem"),
    gateway: path.join(repoRoot, "server/src/_secondary/express/certs/gateway-dev-cert.pem"),
    gatewayKey: path.join(repoRoot, "server/src/_secondary/express/certs/gateway-dev-key.pem"),
    dapp: path.join(repoRoot, "smart-assembly-control/.certs/localhost.pem"),
    dappKey: path.join(repoRoot, "smart-assembly-control/.certs/localhost-key.pem"),
  };
}

export function validatePair(certPath: string, keyPath: string, names: string[], issuerPath?: string) {
  for (const file of [certPath, keyPath, ...(issuerPath ? [issuerPath] : [])]) assertNoSymlink(file);
  const cert = new crypto.X509Certificate(fs.readFileSync(certPath));
  const key = crypto.createPrivateKey(fs.readFileSync(keyPath));
  if (!cert.checkPrivateKey(key)) throw new Error(`Certificate and private key do not match: ${certPath}`);
  const now = Date.now();
  if (Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) <= now) throw new Error(`Certificate is not currently valid: ${certPath}`);
  for (const name of names) {
    if (!(name === "127.0.0.1" ? cert.checkIP(name) : cert.checkHost(name))) throw new Error(`Certificate lacks ${name}: ${certPath}`);
  }
  const issuer = issuerPath ? new crypto.X509Certificate(fs.readFileSync(issuerPath)) : cert;
  if (!cert.verify(issuer.publicKey)) throw new Error(`Certificate issuer verification failed: ${certPath}`);
  if (issuerPath && !issuer.ca) throw new Error(`Issuer is not a certificate authority: ${issuerPath}`);
  return { fingerprint: cert.fingerprint256, expires: cert.validTo };
}

function writePair(certPath: string, keyPath: string, certificate: string, key: string) {
  assertNoSymlink(certPath); assertNoSymlink(keyPath);
  fs.mkdirSync(path.dirname(certPath), { recursive: true });
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  // Exclusive creation never rotates a partially missing or existing pair.
  fs.writeFileSync(keyPath, "", { flag: "wx", mode: 0o600 });
  try {
    protectPrivateKey(keyPath);
    fs.writeFileSync(keyPath, key, { flag: "r+" });
    fs.writeFileSync(certPath, certificate, { flag: "wx", mode: 0o644 });
  }
  catch (error) { fs.unlinkSync(keyPath); throw error; }
}

function protectPrivateKey(keyPath: string) {
  if (process.platform !== "win32") { fs.chmodSync(keyPath, 0o600); return; }
  const result = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `
    $ErrorActionPreference = 'Stop'
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = [Security.AccessControl.FileSecurity]::new()
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow'))
    Set-Acl -LiteralPath $env:EVEJS_TLS_PRIVATE_FILE -AclObject $acl
    $actual = Get-Acl -LiteralPath $env:EVEJS_TLS_PRIVATE_FILE
    $allowed = @($actual.Access | Where-Object AccessControlType -eq 'Allow')
    if ($allowed.Count -ne 1 -or $allowed[0].IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Private-key ACL verification failed' }
  `], { encoding: "utf8", timeout: 15000, env: { ...process.env, EVEJS_TLS_PRIVATE_FILE: keyPath } });
  if (result.error || result.status !== 0) throw new Error(`Could not restrict private-key ACL: ${result.error?.message || result.stderr}`);
}

export function ensureCertificates(repoRoot: string) {
  const forge = require("node-forge");
  const files = certificatePaths(repoRoot);
  const pairs = [[files.ca, files.caKey], [files.xmpp, files.xmppKey], [files.gateway, files.gatewayKey], [files.dapp, files.dappKey]];
  for (const pair of pairs) {
    for (const file of pair) assertNoSymlink(file);
    if (fs.existsSync(pair[0]) !== fs.existsSync(pair[1])) throw new Error(`Incomplete TLS pair; restore the missing file before setup: ${pair[0]}`);
  }
  function make(names: string[], ca = false, parent?: { cert: any; key: any }) {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = `01${crypto.randomBytes(15).toString("hex")}`;
    cert.validity.notBefore = new Date(Date.now() - 300000);
    cert.validity.notAfter = new Date(Date.now() + (ca ? 3650 : 365) * 86400000);
    cert.setSubject([{ name: "commonName", value: names[0] }]);
    cert.setIssuer(parent ? parent.cert.subject.attributes : cert.subject.attributes);
    cert.setExtensions([
      { name: "basicConstraints", cA: ca, critical: true },
      { name: "keyUsage", keyCertSign: ca, cRLSign: ca, digitalSignature: true, keyEncipherment: !ca, critical: true },
      ...(ca ? [] : [{ name: "extKeyUsage", serverAuth: true, critical: true }, {
        name: "subjectAltName", altNames: names.map(value => value === "127.0.0.1" ? { type: 7, ip: value } : { type: 2, value }),
      }]),
      { name: "subjectKeyIdentifier" },
    ]);
    cert.sign(parent?.key || keys.privateKey, forge.md.sha256.create());
    return { cert, key: keys.privateKey, certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey) };
  }
  if (!fs.existsSync(files.ca)) {
    const ca = make(["EvEJS Local Development CA"], true);
    writePair(files.ca, files.caKey, ca.certPem, ca.keyPem);
  }
  validatePair(files.ca, files.caKey, []);
  if (!new crypto.X509Certificate(fs.readFileSync(files.ca)).ca) throw new Error("The configured game CA is not a certificate authority.");
  const ca = { cert: forge.pki.certificateFromPem(fs.readFileSync(files.ca, "utf8")), key: forge.pki.privateKeyFromPem(fs.readFileSync(files.caKey, "utf8")) };
  for (const [certPath, keyPath, names, signed] of [
    [files.xmpp, files.xmppKey, ["localhost", "127.0.0.1"], true],
    [files.gateway, files.gatewayKey, [...GATEWAY_NAMES, "127.0.0.1"], true],
    [files.dapp, files.dappKey, ["localhost", "dev.dapps.evefrontier.com", "127.0.0.1"], false],
  ] as [string, string, string[], boolean][]) {
    if (!fs.existsSync(certPath)) {
      const leaf = make(names, false, signed ? ca : undefined);
      writePair(certPath, keyPath, leaf.certPem, leaf.keyPem);
    }
    validatePair(certPath, keyPath, names, signed ? files.ca : undefined);
  }
  for (const [, key] of pairs) protectPrivateKey(key);
  return { files, trustInstalled: false, message: "Certificate files verified. Browser and Wine trust stores must be configured separately." };
}
