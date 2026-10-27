#!/usr/bin/env python3
"""Validate exact build 3640684 patches on disposable copies, without launching.

This is an offline acceptance check, not promotion of the client or mutation of
an installed Bottles/Windows client. Full stage trust validation remains in
frontier_windows_client.py and the Windows PowerShell launcher.
"""
from pathlib import Path
import argparse, hashlib, importlib.util, json, marshal, shutil, sys, tempfile, zipfile

HERE=Path(__file__).resolve().parent
SOURCE_ARCHIVE_SHA256='2f43f4b8d34632b5d5fdc7b58af93364f606bd9ba67fcada588565ee0628122c'
def module(name):
 spec=importlib.util.spec_from_file_location(name,HERE/(name+'.py'));value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

def verify(root):
 if sys.version_info[:2] != (3,12):raise RuntimeError('Python3.12 exactly is required')
 win=module('frontier_windows_client');docking=module('patch_frontier_docking');features=module('patch_frontier_features')
 source=root/'stillness';archive=source/'code.ccp';blue=source/'bin64/blue.pyd'
 before={str(p.relative_to(root)):win.sha256_file(p) for p in [archive,blue,source/'start.ini']}
 if before['stillness/code.ccp'] != SOURCE_ARCHIVE_SHA256:raise RuntimeError('Client archive is not the exact supplied3640684 source')
 if 'build=3640684' not in (source/'start.ini').read_text().replace(' ',''):raise RuntimeError('Unexpected start.ini build')
 _,profile=win.resolve_profile(3640684,'blue.pyd')
 assert win.inspect_blue(blue,profile)=='source'
 with zipfile.ZipFile(archive) as z:
  macho=marshal.loads(z.read('eve/common/script/net/eveMachoNetVersion.pyc')[16:])
  if 489 not in macho.co_consts:raise RuntimeError('Macho489 not independently confirmed')
  source_hashes={name:hashlib.sha256(z.read(name)).hexdigest() for name in z.namelist()}
 with tempfile.TemporaryDirectory(prefix='evejs-3640684-copy-') as temporary:
  stage=Path(temporary);copied_archive=stage/'code.ccp';copied_blue=stage/'blue.pyd'
  shutil.copy2(archive,copied_archive);shutil.copy2(blue,copied_blue)
  assert win.code_patch_states(copied_archive,3640684)=={'docking':'source','features':'source'}
  assert win.patch_blue_atomic(copied_blue,profile)=='target'
  assert win.patch_blue_atomic(copied_blue,profile)=='target'
  assert win.patch_code_archive(copied_archive,3640684)=={'docking':'patched','features':'patched'}
  assert win.patch_code_archive(copied_archive,3640684)=={'docking':'patched','features':'patched'}
  expected={docking.MODULE_NAME,*features.BUILD_MODULE_PATCHES[3640684]}
  with zipfile.ZipFile(copied_archive) as z:
   assert set(z.namelist())==set(source_hashes)
   changed={name for name in z.namelist() if hashlib.sha256(z.read(name)).hexdigest()!=source_hashes[name]}
   assert changed==expected,(changed,expected)
  altered=bytearray(copied_blue.read_bytes());altered[-100]^=1
  assert win.inspect_blue_bytes(bytes(altered),profile)!='target'
  results={'build':3640684,'macho':489,'nativeBlue':{'sourceSha256':before['stillness/bin64/blue.pyd'],'targetSha256':win.sha256_file(copied_blue)},
    'codeArchive':{'sourceSha256':before['stillness/code.ccp'],'patchedCopySha256':win.sha256_file(copied_archive),'changedMembers':sorted(changed),'unchangedMemberCount':len(source_hashes)-len(changed)},
    'idempotent':True,'tamperedNativeRejected':True,'retailUnchanged':True,
    'nativeLaunchValidated':False,'platformScope':'WindowsPE offline; Bottles/nativeWindows execution pending',
    'legacyAdapters':'3502403 custom adapters excluded; current native features retained'}
 after={str(p.relative_to(root)):win.sha256_file(p) for p in [archive,blue,source/'start.ini']}
 if before!=after:raise RuntimeError('Source files changed during verification')
 return results

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--client-root',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args()
 result=verify(a.client_root.resolve());a.report.parent.mkdir(parents=True,exist_ok=True);a.report.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':main()
