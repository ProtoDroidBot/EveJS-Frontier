#!/usr/bin/env python3
"""WinVerifyTrust and exact ROOT certificate probe under Windows Python.

Invoked by frontier_linux_client.py in the selected Wine prefix. A runner whose
WinVerifyTrust implementation cannot validate the signature fails closed.
"""
import argparse
import base64
import ctypes
from ctypes import wintypes
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
import tempfile


def tampered_pe_bytes(original):
    """Change signed section content on a disposable copy, preserving PE layout."""
    payload = bytearray(original)
    if payload[:2] != b"MZ" or len(payload) < 0x40:
        raise RuntimeError("Executable is not an MZ image.")
    pe = struct.unpack_from("<I", payload, 0x3c)[0]
    if pe + 24 > len(payload) or payload[pe:pe + 4] != b"PE\0\0":
        raise RuntimeError("Executable has no valid PE header.")
    optional_size = struct.unpack_from("<H", payload, pe + 20)[0]
    section = pe + 24 + optional_size
    if section + 40 > len(payload):
        raise RuntimeError("Executable has no complete first PE section.")
    raw_size, raw_pointer = struct.unpack_from("<II", payload, section + 16)
    if raw_size == 0 or raw_pointer + raw_size > len(payload) or raw_pointer < section + 40:
        raise RuntimeError("Executable section cannot be used for signature negative control.")
    payload[raw_pointer] ^= 1
    return bytes(payload)


def read_public_der(path):
    data = path.read_bytes()
    if b"PRIVATE KEY" in data:
        raise RuntimeError("Trust installation accepts public certificates only, never private keys.")
    blocks = re.findall(rb"-----BEGIN CERTIFICATE-----\s+([A-Za-z0-9+/=\s]+?)-----END CERTIFICATE-----", data)
    if len(blocks) != 1:
        raise RuntimeError("Expected exactly one public PEM certificate.")
    return base64.b64decode(re.sub(rb"\s", b"", blocks[0]), validate=True)


def verify(exefile, ca, *, install=False, dapp_cert=None):
    if sys.platform != "win32" or sys.version_info[:2] != (3, 12) or struct.calcsize("P") != 8:
        raise RuntimeError("The trust probe requires Windows CPython 3.12 x64.")
    der = read_public_der(ca)
    dapp_der = read_public_der(dapp_cert) if dapp_cert else None
    if install and dapp_der is None:
        raise RuntimeError("Explicit trust installation requires the public dApp certificate too.")

    class GUID(ctypes.Structure):
        _fields_ = [("Data1", wintypes.DWORD), ("Data2", wintypes.WORD),
                    ("Data3", wintypes.WORD), ("Data4", ctypes.c_ubyte * 8)]

    class FILE_INFO(ctypes.Structure):
        _fields_ = [("cbStruct", wintypes.DWORD), ("pcwszFilePath", wintypes.LPCWSTR),
                    ("hFile", wintypes.HANDLE), ("pgKnownSubject", ctypes.c_void_p)]

    class TRUST_DATA(ctypes.Structure):
        _fields_ = [("cbStruct", wintypes.DWORD), ("pPolicyCallbackData", ctypes.c_void_p),
                    ("pSIPClientData", ctypes.c_void_p), ("dwUIChoice", wintypes.DWORD),
                    ("fdwRevocationChecks", wintypes.DWORD), ("dwUnionChoice", wintypes.DWORD),
                    ("pFile", ctypes.POINTER(FILE_INFO)), ("dwStateAction", wintypes.DWORD),
                    ("hWVTStateData", wintypes.HANDLE), ("pwszURLReference", wintypes.LPWSTR),
                    ("dwProvFlags", wintypes.DWORD), ("dwUIContext", wintypes.DWORD)]

    file_info = FILE_INFO(ctypes.sizeof(FILE_INFO), str(exefile), None, None)
    trust_data = TRUST_DATA(ctypes.sizeof(TRUST_DATA), None, None, 2, 0, 1,
                            ctypes.pointer(file_info), 0, None, None, 0, 0)
    action = GUID(0x00AAC56B, 0xCD44, 0x11D0, (ctypes.c_ubyte * 8)(0x8C, 0xC2, 0, 0xC0, 0x4F, 0xC2, 0x95, 0xEE))
    wintrust = ctypes.WinDLL("wintrust")
    wintrust.WinVerifyTrust.argtypes = [wintypes.HWND, ctypes.POINTER(GUID), ctypes.POINTER(TRUST_DATA)]
    wintrust.WinVerifyTrust.restype = wintypes.LONG
    if not install:
        result = wintrust.WinVerifyTrust(None, ctypes.byref(action), ctypes.byref(trust_data))
        if result != 0:
            raise RuntimeError(f"Authenticode verification failed: 0x{result & 0xffffffff:08x}")
        # Some Wine runtimes have incomplete trust APIs. A deliberately changed
        # signed-section copy must fail, so a stub returning success cannot
        # silently disable the launcher's signature requirement.
        with tempfile.TemporaryDirectory(prefix="evejs-signature-probe-") as temporary:
            negative = Path(temporary) / "tampered.exe"
            negative.write_bytes(tampered_pe_bytes(exefile.read_bytes()))
            file_info.pcwszFilePath = str(negative)
            if wintrust.WinVerifyTrust(None, ctypes.byref(action), ctypes.byref(trust_data)) == 0:
                raise RuntimeError("Wine accepted a tampered signed executable; signature trust cannot be established.")

    class BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]

    class CERT_CONTEXT(ctypes.Structure):
        _fields_ = [("dwCertEncodingType", wintypes.DWORD),
                    ("pbCertEncoded", ctypes.POINTER(ctypes.c_ubyte)),
                    ("cbCertEncoded", wintypes.DWORD), ("pCertInfo", ctypes.c_void_p),
                    ("hCertStore", wintypes.HANDLE)]

    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    crypt.CertOpenSystemStoreW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    crypt.CertOpenSystemStoreW.restype = wintypes.HANDLE
    crypt.CertFindCertificateInStore.argtypes = [wintypes.HANDLE, wintypes.DWORD,
        wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, ctypes.c_void_p]
    crypt.CertFindCertificateInStore.restype = ctypes.POINTER(CERT_CONTEXT)
    crypt.CertFreeCertificateContext.argtypes = [ctypes.POINTER(CERT_CONTEXT)]
    crypt.CertCloseStore.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    crypt.CertAddEncodedCertificateToStore.argtypes = [wintypes.HANDLE, wintypes.DWORD,
        ctypes.POINTER(ctypes.c_ubyte), wintypes.DWORD, wintypes.DWORD,
        ctypes.POINTER(ctypes.POINTER(CERT_CONTEXT))]
    crypt.CertAddEncodedCertificateToStore.restype = wintypes.BOOL
    crypt.CertDeleteCertificateFromStore.argtypes = [ctypes.POINTER(CERT_CONTEXT)]
    crypt.CertDeleteCertificateFromStore.restype = wintypes.BOOL
    store = crypt.CertOpenSystemStoreW(None, "ROOT")
    if not store:
        raise RuntimeError("Could not open the selected prefix's ROOT certificate store.")
    certificate = None
    added = []
    try:
        for encoded in [der, *([dapp_der] if install else [])]:
            digest = (ctypes.c_ubyte * 20).from_buffer_copy(hashlib.sha1(encoded).digest())
            blob = BLOB(20, digest)
            certificate = crypt.CertFindCertificateInStore(store, 0x00010001, 0, 0x00010000, ctypes.byref(blob), None)
            if not certificate and install:
                payload = (ctypes.c_ubyte * len(encoded)).from_buffer_copy(encoded)
                created = ctypes.POINTER(CERT_CONTEXT)()
                if not crypt.CertAddEncodedCertificateToStore(store, 0x00010001, payload, len(encoded), 1, ctypes.byref(created)):
                    raise RuntimeError("Could not add the public certificate to this prefix's ROOT store.")
                added.append(created)
                certificate = crypt.CertFindCertificateInStore(store, 0x00010001, 0, 0x00010000, ctypes.byref(blob), None)
            if not certificate or ctypes.string_at(certificate.contents.pbCertEncoded, certificate.contents.cbCertEncoded) != encoded:
                raise RuntimeError("The exact public certificate is not trusted in this Wine prefix's ROOT store.")
            crypt.CertFreeCertificateContext(certificate)
            certificate = None
    except Exception:
        rollback_failures = []
        for context in added:
            if not crypt.CertDeleteCertificateFromStore(context):
                rollback_failures.append("could not remove a newly added certificate")
        added.clear()
        if rollback_failures:
            raise RuntimeError("Prefix trust installation failed and rollback was incomplete: " + "; ".join(rollback_failures))
        raise
    finally:
        if certificate:
            crypt.CertFreeCertificateContext(certificate)
        for context in added:
            crypt.CertFreeCertificateContext(context)
        crypt.CertCloseStore(store, 0)
    return {"valid": True, "authenticode": "not-probed; mandatory on launch" if install else "Valid", "caTrustedRoot": True,
            "dappTrustedRoot": bool(install), "dappFingerprintSha256": hashlib.sha256(dapp_der).hexdigest() if install else None,
            "trustInstalled": bool(install),
            "caFingerprintSha256": hashlib.sha256(der).hexdigest(),
            "exefileSha256": hashlib.sha256(exefile.read_bytes()).hexdigest()}


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--exefile", type=Path, required=True)
    cli.add_argument("--ca", type=Path, required=True)
    cli.add_argument("--install", action="store_true", help="Explicitly trust only the supplied public game CA and dApp certificate")
    cli.add_argument("--dapp-cert", type=Path)
    args = cli.parse_args()
    try:
        print(json.dumps(verify(args.exefile, args.ca, install=args.install, dapp_cert=args.dapp_cert)))
        return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
