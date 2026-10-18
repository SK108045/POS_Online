# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['C:\\eTIMS-Analysis\\Programmatic-Fix\\POS-Invoice-Prgrammatic\\Online-POS\\windows\\etims-helper\\local_etims_worker.py'],
    pathex=[],
    binaries=[],
    datas=[('C:\\eTIMS-Analysis\\Programmatic-Fix\\POS-Invoice-Prgrammatic\\Online-POS\\windows\\etims-helper\\fast_engine', 'fast_engine')],
    hiddenimports=['psycopg2', 'psycopg2.extras', 'dotenv', 'urllib.request', 'urllib.parse', 'urllib.error', 'sqlite3', 'json'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='EtimsLocalWorker',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
