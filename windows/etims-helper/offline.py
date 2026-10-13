"""Require persistent eTIMS outbound blocks without changing network policy."""
import json
from settings import require_identity

def require_offline(config=None):
    from workflow import ps
    config=config or require_identity()
    status=json.loads(ps('tools/check-offline.ps1','-InstallationDir',config['installation_dir']))
    if status.get('offline_verified') is not True:
        raise ValueError('eTIMS Internet blocking could not be verified for both the client and launcher on all Windows Firewall profiles. Automation stopped; no network settings were changed.')
    return status
