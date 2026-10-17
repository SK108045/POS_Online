"""Per-user configuration; never store eTIMS login credentials."""
import json
import os
from pathlib import Path
import sys

ASSETS = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
HOME = Path(os.environ.get('ORAFORGE_ETIMS_HOME') or
            Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'OraforgePOS' / 'etims')

def settings():
    path = HOME / 'config.json'
    if not path.exists():
        try:
            HOME.mkdir(parents=True, exist_ok=True)
            default_config = {
                'taxpayer_pin': 'A018733640V',
                'branch_id': '01',
                'port': 17383,
                'installation_dir': r'C:\eTIMS-Paypoint-Win',
                'registration_defaults': {'origin': 'KE'},
                'fast_ui': True
            }
            path.write_text(json.dumps(default_config, indent=2), encoding='utf-8')
        except Exception:
            pass
    value = json.loads(path.read_text(encoding='utf-8-sig')) if path.exists() else {}
    install = Path(value.get('installation_dir', r'C:\eTIMS-Paypoint-Win'))
    database = Path(value.get('database_path') or
                    Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'EBM2x/sqlite/RRA_EBM2x.db')
    return {**value, 'installation_dir': str(install), 'database_path': str(database),
            'registration_defaults': value.get('registration_defaults',{'origin':'KE'}),
            'branch_id': value.get('branch_id', '01'), 'port': int(value.get('port', 17383)),
            'fast_ui': value.get('fast_ui', True),
            'taxpayer_pin': value.get('taxpayer_pin', 'A018733640V')}

def require_identity():
    import re
    value = settings()
    if not re.fullmatch(r'[A-Z]\d{9}[A-Z]', value.get('taxpayer_pin', '')):
        raise ValueError('Configure this device\'s registered seller KRA PIN in the Windows helper settings.')
    if not re.fullmatch(r'\d{2}', value['branch_id']):
        raise ValueError('Configure the registered two-digit eTIMS branch ID.')
    return value
