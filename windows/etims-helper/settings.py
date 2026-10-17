"""Per-user configuration; never store eTIMS login credentials."""
import json
import os
from pathlib import Path
import sys

ASSETS = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
HOME = Path(os.environ.get('ORAFORGE_ETIMS_HOME') or
            Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'OraforgePOS' / 'etims')

def detect_etims_identity(db_path=None):
    try:
        import urllib.parse
        if not db_path:
            db_path = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'EBM2x/sqlite/RRA_EBM2x.db'
        db_path = Path(db_path)
        sdc_path = Path(str(db_path) + '.RraSdc')
        if not sdc_path.exists():
            sdc_path = db_path.parent / (db_path.name + '.RraSdc')
        if sdc_path.is_file():
            with open(sdc_path, 'rb') as f:
                f.seek(6100)
                length = int(f.read(20).strip())
                f.seek(6200)
                data = f.read(length).decode('latin1')
                j = json.loads(urllib.parse.unquote_plus(data))
                pin = j.get('GblTaxIdNo')
                branch = j.get('GblBrcCod', '01')
                if pin:
                    return {'taxpayer_pin': pin, 'branch_id': branch}
    except Exception:
        pass
    return {}

def settings():
    path = HOME / 'config.json'
    value = json.loads(path.read_text(encoding='utf-8-sig')) if path.exists() else {}
    install = Path(value.get('installation_dir', r'C:\eTIMS-Paypoint-Win'))
    database = Path(value.get('database_path') or
                    Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'EBM2x/sqlite/RRA_EBM2x.db')
    detected = detect_etims_identity(database)
    fallback_pin = detected.get('taxpayer_pin') or ''
    fallback_branch = detected.get('branch_id') or '01'

    if not path.exists() and fallback_pin:
        try:
            HOME.mkdir(parents=True, exist_ok=True)
            default_config = {
                'taxpayer_pin': fallback_pin,
                'branch_id': fallback_branch,
                'port': 17383,
                'installation_dir': str(install),
                'registration_defaults': {'origin': 'KE'},
                'fast_ui': True
            }
            path.write_text(json.dumps(default_config, indent=2), encoding='utf-8')
        except Exception:
            pass

    return {**value, 'installation_dir': str(install), 'database_path': str(database),
            'registration_defaults': value.get('registration_defaults',{'origin':'KE'}),
            'branch_id': value.get('branch_id', fallback_branch), 'port': int(value.get('port', 17383)),
            'fast_ui': value.get('fast_ui', True),
            'taxpayer_pin': value.get('taxpayer_pin', fallback_pin)}

def require_identity():
    import re
    value = settings()
    if not re.fullmatch(r'[A-Z]\d{9}[A-Z]', value.get('taxpayer_pin', '')):
        raise ValueError('Configure this device\'s registered seller KRA PIN in the Windows helper settings.')
    if not re.fullmatch(r'\d{2}', value['branch_id']):
        raise ValueError('Configure the registered two-digit eTIMS branch ID.')
    return value
