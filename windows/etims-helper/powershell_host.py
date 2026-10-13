"""One private, hidden PowerShell worker. Never replay a timed-out operation."""
import atexit
import json
from pathlib import Path
import queue
import subprocess
import threading
import time

from settings import ASSETS

SCRIPTS = frozenset(('read-state.ps1', 'ui-step.ps1', 'tools/check-offline.ps1',
                     'tools/normalize-window.ps1', 'tools/select-observed-combo.ps1',
                     'tools/choose-native-file.ps1', 'tools/decode-qr.ps1', 'tools/check-ui-ready.ps1',
                     'tools/inspect-file-dialog.ps1'))


class PowerShellHost:
    def __init__(self, root=ASSETS):
        self.root = Path(root)
        self.lock = threading.Lock()
        self.process = None
        self.serial = 0
        self.metrics = {}

    def _start(self):
        self.responses = queue.Queue()
        self.process = subprocess.Popen(
            ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-STA',
             '-ExecutionPolicy', 'Bypass', '-File', str(self.root / 'powershell-worker.ps1')],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding='utf-8', bufsize=1,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        # Capture this worker's queue: a late EOF must not poison a replacement.
        stream, responses = self.process.stdout, self.responses

        def receive():
            try:
                for line in stream:
                    try:
                        responses.put(json.loads(line))
                    except (ValueError, TypeError):
                        responses.put(None)
                        return
            finally:
                responses.put(None)

        threading.Thread(target=receive, daemon=True, name='etims-powershell-output').start()

    def _stop(self):
        process, self.process = self.process, None
        if process is None:
            return
        if process.poll() is None:
            process.kill()
        try:
            process.wait(timeout=5)
        finally:
            if process.stdin:
                process.stdin.close()
            if process.stdout:
                process.stdout.close()

    def close(self):
        with self.lock:
            self._stop()

    def execute(self, script, args=(), timeout=90):
        script = str(script).replace('\\', '/')
        if script not in SCRIPTS:
            raise ValueError('Unsupported helper PowerShell operation')
        with self.lock:
            started = time.perf_counter()
            try:
                if self.process is None or self.process.poll() is not None:
                    self._stop()
                    self._start()
                self.serial += 1
                serial = self.serial
                message = json.dumps(dict(id=serial, script=script, args=list(map(str, args))),
                                     ensure_ascii=True)
                self.process.stdin.write(message + '\n')
                self.process.stdin.flush()
                response = self.responses.get(timeout=timeout)
                if not isinstance(response, dict) or response.get('id') != serial:
                    raise RuntimeError('Windows worker stopped; review this same sale before retrying')
                if not isinstance(response.get('output'), str):
                    raise RuntimeError('Invalid Windows worker response; operation was not retried')
                return subprocess.CompletedProcess(
                    [script], 0 if response.get('ok') is True else 1,
                    stdout=response['output'].encode('utf-8'),
                    stderr=str(response.get('error', '')).encode('utf-8'))
            except queue.Empty:
                self._stop()
                raise RuntimeError('Windows worker timed out; operation was not retried. Recover this same sale.') from None
            except (OSError, RuntimeError):
                self._stop()
                raise RuntimeError('Windows worker stopped; operation was not retried. Recover this same sale.') from None
            finally:
                # Script names and durations only. No arguments, values or output.
                elapsed = time.perf_counter() - started
                metric = self.metrics.setdefault(script, dict(calls=0, seconds=0, max_seconds=0))
                metric['calls'] += 1
                metric['seconds'] += elapsed
                metric['max_seconds'] = max(metric['max_seconds'], elapsed)
                from timing import CURRENT
                recorder = CURRENT.get()
                if recorder is not None:
                    recorder.script(script, elapsed)


HOST = PowerShellHost()
atexit.register(HOST.close)


def execute(script, args=(), timeout=90):
    return HOST.execute(script, args, timeout)
