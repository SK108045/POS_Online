import json
import time
from settings import require_identity

_CACHE = {}

def require_offline(config=None, max_age=30.0, force=False):
    from workflow import ps
    now = time.monotonic()
    config = config or require_identity()
    inst_dir = config['installation_dir']
    if not force and inst_dir in _CACHE:
        timestamp, cached_status = _CACHE[inst_dir]
        if now - timestamp < max_age:
            return cached_status
    status = json.loads(ps('tools/check-offline.ps1', '-InstallationDir', inst_dir))
    if status.get('offline_verified') is not True:
        _CACHE.pop(inst_dir, None)
        raise ValueError('eTIMS Internet blocking could not be verified for both the client and launcher on all Windows Firewall profiles. Automation stopped; no network settings were changed.')
    _CACHE[inst_dir] = (now, status)
    return status

