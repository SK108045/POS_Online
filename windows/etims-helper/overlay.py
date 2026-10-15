"""Ghost overlay lifecycle manager for eTIMS checkout concealment."""
import datetime
import os
import subprocess
import sys
from pathlib import Path
from settings import HOME

def _log(msg):
    try:
        log_file = HOME / 'overlay.log'
        ts = datetime.datetime.now().isoformat()
        with open(log_file, 'a', encoding='utf-8') as f:
            f.write(f"[{ts}] {msg}\n")
    except Exception:
        pass

class GhostOverlaySession:
    def __init__(self, bounds=None, timeout=90):
        self.bounds = bounds
        self.timeout = timeout
        self.proc = None
        self._started = False

    def start(self):
        try:
            candidates = []
            if getattr(sys, 'frozen', False):
                base = Path(sys._MEIPASS)
                candidates.append(base / 'tools' / 'GhostOverlay.exe')
                candidates.append(Path(sys.executable).parent / '_internal' / 'tools' / 'GhostOverlay.exe')
                candidates.append(Path(sys.executable).parent / 'tools' / 'GhostOverlay.exe')
            here = Path(__file__).resolve().parent
            candidates.append(here / 'tools' / 'GhostOverlay.exe')

            exe = None
            for c in candidates:
                if c.is_file():
                    exe = str(c)
                    break

            if not exe:
                _log(f"GhostOverlay.exe not found. Candidates: {[str(c) for c in candidates]}")
                return self

            args = [exe]
            if self.bounds and isinstance(self.bounds, dict):
                left = self.bounds.get('Left', 0)
                top = self.bounds.get('Top', 0)
                width = self.bounds.get('Width', self.bounds.get('Right', 0) - left)
                height = self.bounds.get('Height', self.bounds.get('Bottom', 0) - top)
                if width > 0 and height > 0:
                    args.extend([str(int(left)), str(int(top)), str(int(width)), str(int(height))])

            args.append(str(int(self.timeout)))
            _log(f"Starting GhostOverlay: {args}")

            self.proc = subprocess.Popen(
                args,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                text=True,
                encoding='utf-8'
            )
            self._started = True
            _log(f"GhostOverlay started with PID: {self.proc.pid}")
        except Exception as ex:
            _log(f"GhostOverlay failed to start: {ex}")
            self.proc = None
        return self

    def update(self, progress, stage_text=""):
        if not self.proc or not self._started:
            return
        try:
            msg = f"PROGRESS:{int(progress)}:{stage_text}\n"
            self.proc.stdin.write(msg)
            self.proc.stdin.flush()
            _log(f"Overlay progress update: {int(progress)}% - {stage_text}")
        except Exception as ex:
            _log(f"Overlay progress error: {ex}")

    def close(self):
        if not self.proc:
            return
        try:
            _log("Closing GhostOverlay")
            self.proc.stdin.write("CLOSE\n")
            self.proc.stdin.flush()
            self.proc.stdin.close()
            self.proc.wait(timeout=1.5)
            _log("GhostOverlay exited cleanly")
        except Exception as ex:
            _log(f"GhostOverlay force killing: {ex}")
            try:
                self.proc.kill()
            except Exception:
                pass
        finally:
            self.proc = None
            self._started = False

    def __enter__(self):
        return self.start()

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
