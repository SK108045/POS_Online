#!/usr/bin/env python3
"""Build the Windows x64 portable POS package from Linux using Go and a Node LTS ZIP."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = 'v24.21.0'
CACHE = ROOT / 'windows/.cache'
OUT = ROOT / 'dist/windows'
STAGE = OUT / 'OraforgePOS'
CACHE.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)
archive = f'node-{VERSION}-win-x64.zip'
base = f'https://nodejs.org/dist/{VERSION}'

def download(name):
    dest = CACHE / name
    if not dest.exists():
        temp = dest.with_suffix(dest.suffix + '.part')
        subprocess.run(['curl', '-fsSL', '--continue-at', '-', '--retry', '2', '--retry-all-errors', '--max-time', '900', f'{base}/{name}', '-o', str(temp)], check=True)
        temp.replace(dest)
    return dest

print('Downloading and verifying the Windows Node runtime...', flush=True)
sums = download('SHASUMS256.txt').read_text()
expected = next(line.split()[0] for line in sums.splitlines() if line.split()[-1] == archive)
nodezip = download(archive)
if hashlib.sha256(nodezip.read_bytes()).hexdigest() != expected:
    raise SystemExit('Node ZIP checksum mismatch; remove windows/.cache and retry.')
subprocess.run(['npm', 'run', 'build:bridge'], cwd=ROOT/'capacitor', check=True)
if STAGE.exists():
    shutil.rmtree(STAGE)
(STAGE/'runtime').mkdir(parents=True)
with zipfile.ZipFile(nodezip) as z:
    prefix = f'node-{VERSION}-win-x64/'
    for name in ['node.exe', 'LICENSE']:
        (STAGE/'runtime'/name).write_bytes(z.read(prefix+name))
app = STAGE/'app/capacitor'
app.mkdir(parents=True)
shutil.copytree(ROOT/'capacitor/www', app/'www')
for name in ['dev-server.js','auto-backup.js','sms.js','swifta.js','swifta-config.js','swifta-contract.js','sozuri-config.json']:
    shutil.copy2(ROOT/'capacitor'/name, app/name)
shutil.copy2(ROOT/'swifta.txt', STAGE/'app/swifta.txt')
hash_ = hashlib.sha256((VERSION+(ROOT/'windows/launcher_windows.go').read_text()).encode())
for file in sorted((STAGE/'app').rglob('*')):
    if file.is_file():
        hash_.update(str(file.relative_to(STAGE)).encode())
        hash_.update(file.read_bytes())
build = hash_.hexdigest()[:16]
print('Compiling the Windows launcher...', flush=True)
subprocess.run(['go','build','-trimpath','-ldflags',f'-s -w -H windowsgui -X main.buildID={build}', '-o',str(STAGE/'OraforgePOS.exe'), str(ROOT/'windows/launcher_windows.go')], env={**os.environ,'GOOS':'windows','GOARCH':'amd64','CGO_ENABLED':'0'},check=True,cwd=ROOT)
(STAGE/'Stop POS.cmd').write_bytes(b'@echo off\r\n"%~dp0OraforgePOS.exe" --stop\r\n')
shutil.copy2(ROOT/'windows/START-HERE.txt', STAGE/'START-HERE.txt')
(STAGE/'build-info.json').write_text(json.dumps({'platform':'windows-x64','node':VERSION,'node_zip_sha256':expected,'node_source':f'{base}/{archive}','build':build},indent=2)+'\n')
zip_path = OUT/'OraforgePOS-Windows-x64.zip'
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for file in sorted(STAGE.rglob('*')):
        if file.is_file(): z.write(file, file.relative_to(OUT))
sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
zip_path.with_suffix('.zip.sha256').write_text(f'{sha}  {zip_path.name}\n')
print(f'Built: {zip_path}\nSize: {zip_path.stat().st_size/1024/1024:.1f} MB\nBuild: {build}',flush=True)
