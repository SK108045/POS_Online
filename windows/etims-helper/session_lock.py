"""One UI owner across processes, released by Windows even after a crash."""
import ctypes
from ctypes import wintypes
import json
import os
from contextlib import contextmanager
from settings import HOME

@contextmanager
def exclusive_client():
    if os.name != 'nt':
        raise RuntimeError('Native invoice automation requires an interactive Windows session')
    api=ctypes.WinDLL('kernel32',use_last_error=True)
    api.CreateMutexW.argtypes=[wintypes.LPVOID,wintypes.BOOL,wintypes.LPCWSTR]
    api.CreateMutexW.restype=wintypes.HANDLE
    api.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD]
    api.WaitForSingleObject.restype=wintypes.DWORD
    api.ReleaseMutex.argtypes=[wintypes.HANDLE]
    api.CloseHandle.argtypes=[wintypes.HANDLE]
    handle=api.CreateMutexW(None,False,'Local\\OraforgeEtimsInteractiveClientV2')
    if not handle:raise RuntimeError('Could not acquire the native UI session guard')
    acquired=False
    try:
        outcome=api.WaitForSingleObject(handle,0)
        if outcome not in (0,0x80):raise RuntimeError('Another helper owns the eTIMS UI; retry this same sale later')
        acquired=True
        yield
    finally:
        if acquired:api.ReleaseMutex(handle)
        api.CloseHandle(handle)

def process_alive(pid):
    if not isinstance(pid,int) or isinstance(pid,bool) or pid<=0:
        raise ValueError('Invalid interrupted automation lock owner')
    api=ctypes.WinDLL('kernel32',use_last_error=True)
    api.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
    api.OpenProcess.restype=wintypes.HANDLE
    api.GetExitCodeProcess.argtypes=[wintypes.HANDLE,ctypes.POINTER(wintypes.DWORD)]
    api.CloseHandle.argtypes=[wintypes.HANDLE]
    handle=api.OpenProcess(0x1000,False,pid)
    if not handle:
        if ctypes.get_last_error()==87:return False
        raise RuntimeError('Could not verify the interrupted automation process')
    try:
        code=wintypes.DWORD()
        if not api.GetExitCodeProcess(handle,ctypes.byref(code)):
            raise RuntimeError('Could not verify the interrupted automation process')
        return code.value==259
    finally:api.CloseHandle(handle)

def reclaim_dead_lock(key):
    """Only called while owning the mutex; retain locks for any other sale."""
    lock=HOME/'active-run.lock'
    if not lock.exists():return
    owner=json.loads(lock.read_text(encoding='utf-8'))
    if owner.get('request_id')!=key or process_alive(owner.get('pid')):
        raise ValueError('A different or active invoice run holds the lock; recover its sale first')
    # This is only an automation ownership marker. The durable invoice ledger
    # remains intact and run() reconciles it before attempting any UI action.
    lock.unlink()
