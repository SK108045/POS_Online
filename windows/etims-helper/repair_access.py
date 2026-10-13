"""Explicit operator repair: UAC-approved, interactive helper startup only."""
import ctypes
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request

from settings import ASSETS, HOME, settings
from windows_access import is_elevated


def ensure_idle():
    database = HOME/'companion.sqlite3'
    if database.exists():
        with closing(sqlite3.connect('file:'+database.as_posix()+'?mode=ro', uri=True)) as connection:
            states = [row[0] for row in connection.execute('SELECT state FROM jobs')]
        if any(state not in ('complete', 'review_required', 'failed', 'needs_details') for state in states):
            raise ValueError('An invoice is running. Let it finish before repairing helper startup.')
    if (HOME/'active-run.lock').exists():
        raise ValueError('An invoice recovery lock exists. Keep the saved sale and review it before repairing startup.')


def install(executable, start=False):
    command = ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
               '-File', str(ASSETS/'Install-Startup.ps1'), '-HelperExe', str(executable), '-Highest']
    if start:
        command.append('-StartOnly')
    result = subprocess.run(command, capture_output=True, timeout=45,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('Windows could not configure the approved helper startup task')
    return None if start else json.loads(result.stdout.decode('utf-8-sig'))


def repair():
    from offline import require_offline
    from session_lock import exclusive_client
    config = settings()
    executable = Path(sys.executable).resolve()
    if Path(config.get('helper_exe', '')).resolve() != executable:
        raise ValueError('Run Repair eTIMS Helper Access using the currently configured bundled helper.')
    # This only inspects existing rules. No firewall mutation is performed.
    require_offline(config)
    with exclusive_client():
        ensure_idle()
        url = 'http://127.0.0.1:'+str(config['port'])+'/health'
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                health = json.load(response)
        except (urllib.error.URLError, TimeoutError):
            health = None
        allowed={executable}
        if config.get('previous_helper_exe'):
            allowed.add(Path(config['previous_helper_exe']).resolve())
        if health and (health.get('app') != 'oraforge-etims-helper' or
                       Path(health.get('runtime_executable', '')).resolve() not in allowed):
            raise ValueError('Another runtime owns the helper port. Keep the saved sale and review startup.')
        startup = install(executable)
        # Preserve every setting, ledger and transaction. Only startup metadata changes.
        config = {**config, **startup}
        temporary = HOME/'config.next'
        temporary.write_text(json.dumps(config, indent=2), encoding='utf-8')
        temporary.replace(HOME/'config.json')
        if health:
            # Structured PowerShell parameters; stop only the verified helper listener.
            command = '''$ErrorActionPreference='Stop'
$root=if($env:ORAFORGE_ETIMS_HOME){$env:ORAFORGE_ETIMS_HOME}else{Join-Path $env:LOCALAPPDATA 'OraforgePOS\\etims'}
$config=Get-Content -LiteralPath (Join-Path $root 'config.json') -Raw | ConvertFrom-Json
$owners=@(Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort $config.port | Select-Object -ExpandProperty OwningProcess -Unique)
foreach($owner in $owners){
 $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$owner)
 if($process.Name -ne 'OraforgeEtims.exe' -or @($config.helper_exe,$config.previous_helper_exe) -notcontains $process.ExecutablePath){throw 'Unexpected helper owner'}
 Stop-Process -Id $owner -ErrorAction Stop
}
'''
            result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command],
                capture_output=True, timeout=15, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            if result.returncode:
                raise RuntimeError('Could not stop the old helper. The approved startup task is installed; restart Windows before recovering the sale.')
        install(executable, start=True)
    deadline = time.monotonic()+30
    while True:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                active = json.load(response)
            if active.get('elevated') is True and Path(active['runtime_executable']).resolve() == executable:
                return
        except (OSError, ValueError, KeyError):
            pass
        if time.monotonic() >= deadline:
            raise RuntimeError('The approved helper startup task is installed. Restart Windows, open eTIMS normally, then recover this same sale.')
        time.sleep(.25)


def run():
    if not getattr(sys, 'frozen', False) or os.name != 'nt':
        raise ValueError('Use the bundled OraforgeEtims.exe to repair Windows access')
    if not is_elevated():
        shell = ctypes.windll.shell32.ShellExecuteW
        shell.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_wchar_p,
                          ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_int]
        shell.restype = ctypes.c_void_p
        outcome = shell(None, 'runas', sys.executable, '--repair-access', str(Path(sys.executable).parent), 1)
        if not outcome or outcome <= 32:
            raise RuntimeError('Windows administrator approval was cancelled; helper access was not changed')
        return
    try:
        repair()
    except (RuntimeError, ValueError) as error:
        ctypes.windll.user32.MessageBoxW(None, str(error), 'Oraforge eTIMS Helper Access', 16)
        return
    ctypes.windll.user32.MessageBoxW(None,
        'Helper administrator access and Windows startup are repaired.\n'
        'Use Manage eTIMS invoice > Recover this sale on the existing paid receipt.\n'
        'Existing invoices and firewall rules were preserved.', 'Oraforge eTIMS Helper Access', 64)
