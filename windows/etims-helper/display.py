"""Read-only display preflight. No native input, normalization or settings edits."""
import hashlib
import json
from pathlib import Path
from settings import HOME, settings
from ui_map import UI_MAP

def require_display(pid,result=None):
    if result is None:
        from workflow import ps
        result=json.loads(ps('tools/display-state.ps1','-TargetProcessId',str(pid)))
    if not result.get('ready'):
        raise ValueError(result.get('problem') or 'Unsupported display settings; run the helper machine check')
    return result

def machine_check():
    from workflow import ps
    config=settings()
    binary=Path(config['installation_dir'])/'bin/EBM2x.dll'
    actual=hashlib.sha256(binary.read_bytes()).hexdigest() if binary.is_file() else None
    native=json.loads(ps('tools/machine-check.ps1','-DiagnosticDirectory',str(HOME/'diagnostics')))
    return dict(read_only=True,client_sha256=actual,verified_client_sha256=UI_MAP['client_sha256'],
                build_matches=actual==UI_MAP['client_sha256'],**{k:v for k,v in native.items() if k!='read_only'})
