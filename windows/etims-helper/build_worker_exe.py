"""
Build Script: Standalone EtimsLocalWorker.exe
---------------------------------------------
Compiles local_etims_worker.py into a self-contained Windows executable
using PyInstaller, bundling the high-speed fast_engine and all required dependencies.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

HELPER_DIR = Path(__file__).resolve().parent
FAST_ENGINE_DIR = HELPER_DIR / "fast_engine"
DIST_DIR = HELPER_DIR / "dist"
BUILD_DIR = HELPER_DIR / "build"


def build():
    print("=" * 65)
    print("     BUILDING STANDALONE ETIMS LOCAL WORKER EXECUTABLE")
    print("=" * 65)

    if not FAST_ENGINE_DIR.exists():
        print(f"[ERROR] Fast engine directory not found at: {FAST_ENGINE_DIR}")
        sys.exit(1)

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name", "EtimsLocalWorker",
        "--add-data", f"{FAST_ENGINE_DIR};fast_engine",
        "--hidden-import", "psycopg2",
        "--hidden-import", "psycopg2.extras",
        "--hidden-import", "dotenv",
        "--hidden-import", "urllib.request",
        "--hidden-import", "urllib.parse",
        "--hidden-import", "urllib.error",
        "--hidden-import", "sqlite3",
        "--hidden-import", "json",
        str(HELPER_DIR / "local_etims_worker.py")
    ]

    print(f"\n[1/3] Running PyInstaller...")
    print("Command:", " ".join(cmd))
    res = subprocess.run(cmd, cwd=str(HELPER_DIR))
    if res.returncode != 0:
        print("[ERROR] PyInstaller compilation failed!")
        sys.exit(res.returncode)

    built_exe = DIST_DIR / "EtimsLocalWorker.exe"
    target_exe = HELPER_DIR / "EtimsLocalWorker.exe"

    if built_exe.exists():
        print(f"\n[2/3] Copying executable to helper root: {target_exe}")
        shutil.copy2(built_exe, target_exe)

    # Ensure fast_engine is also present alongside the EXE
    target_fast_engine = HELPER_DIR / "fast_engine"
    if not target_fast_engine.exists():
        shutil.copytree(FAST_ENGINE_DIR, target_fast_engine)

    print("\n[3/3] Verifying generated executable...")
    if target_exe.exists():
        size_mb = target_exe.stat().st_size / (1024 * 1024)
        print(f"  [OK] EtimsLocalWorker.exe generated successfully! Size: {size_mb:.2f} MB")
        print(f"  Path: {target_exe}")
    else:
        print("[ERROR] EtimsLocalWorker.exe not found!")
        sys.exit(1)

    print("\n" + "=" * 65)
    print("   [SUCCESS] STANDALONE ETIMS WORKER EXE READY FOR CASHIER USE!")
    print("=" * 65)


if __name__ == "__main__":
    build()
