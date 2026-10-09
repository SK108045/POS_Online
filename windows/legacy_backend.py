"""Optional legacy Python POS backend, packaged with CPython by PyInstaller.

The improved-ui desktop POS uses Node on port 3000. This separate Python
compatibility service uses port 5000 ONLY when launched explicitly.
"""
import os
from pathlib import Path
import shutil
import sys
from http.server import ThreadingHTTPServer

import app
import profiles


def prepare_data():
    base = os.environ.get("POS_LEGACY_DATA_DIR")
    if not base:
        base = str(Path(os.environ.get("LOCALAPPDATA", Path.home())) / "OraforgePOS" / "legacy")
    root = Path(base).resolve()
    root.mkdir(parents=True, exist_ok=True)
    resource_root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    static = root / "static"
    # Refresh shipped UI while preserving client-uploaded files.
    if (resource_root / "static").is_dir():
        shutil.copytree(
            resource_root / "static", static, dirs_exist_ok=True,
            ignore=lambda directory, files: ["uploads"] if Path(directory).name == "static" and "uploads" in files else [],
        )
        samples = resource_root / "static/uploads"
        (static / "uploads").mkdir(parents=True, exist_ok=True)
        if samples.is_dir():
            for asset in samples.iterdir():
                if asset.is_file() and not (static / "uploads" / asset.name).exists():
                    shutil.copy2(asset, static / "uploads" / asset.name)
    (root / "data").mkdir(parents=True, exist_ok=True)
    os.chdir(root)
    app.BASE_DIR = root
    app.DATA_DIR = root / "data"
    app.DB_PATH = root / "data/pos.sqlite3"
    app.STATIC_DIR = static
    profiles.BASE_DIR = root
    profiles.STATIC_DIR = static
    profiles.UPLOAD_DIR = static / "uploads"
    return root


if __name__ == "__main__":
    prepare_data()
    app.init_db()
    host = "127.0.0.1"
    port = int(os.environ.get("POS_LEGACY_PORT", "5000"))
    print(f"Oraforge legacy Python POS listening at http://{host}:{port}", flush=True)
    class Server(ThreadingHTTPServer):
        allow_reuse_address = True
    Server((host, port), app.POSHandler).serve_forever()
