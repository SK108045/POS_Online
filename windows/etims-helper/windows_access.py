"""Inspect process access levels. Never elevate or alter another application."""
import ctypes
from ctypes import wintypes as W
import os


def process_access(pid):
    if os.name != 'nt':
        raise RuntimeError('Native UI access requires Windows')
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    security = ctypes.WinDLL('advapi32', use_last_error=True)
    kernel.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]
    kernel.OpenProcess.restype = W.HANDLE
    kernel.CloseHandle.argtypes = [W.HANDLE]
    kernel.ProcessIdToSessionId.argtypes = [W.DWORD, ctypes.POINTER(W.DWORD)]
    security.OpenProcessToken.argtypes = [W.HANDLE, W.DWORD, ctypes.POINTER(W.HANDLE)]
    security.GetTokenInformation.argtypes = [W.HANDLE, ctypes.c_int, W.LPVOID, W.DWORD, ctypes.POINTER(W.DWORD)]
    security.GetSidSubAuthorityCount.argtypes = [W.LPVOID]
    security.GetSidSubAuthorityCount.restype = ctypes.POINTER(ctypes.c_ubyte)
    security.GetSidSubAuthority.argtypes = [W.LPVOID, W.DWORD]
    security.GetSidSubAuthority.restype = ctypes.POINTER(W.DWORD)
    process = kernel.OpenProcess(0x1000, False, pid)
    token = W.HANDLE()
    if not process:
        raise RuntimeError('Could not inspect eTIMS Windows access level')
    try:
        if not security.OpenProcessToken(process, 8, ctypes.byref(token)):
            raise RuntimeError('Could not inspect eTIMS Windows access level')
        elevated, size, session = W.DWORD(), W.DWORD(), W.DWORD()
        if not security.GetTokenInformation(token, 20, ctypes.byref(elevated), 4, ctypes.byref(size)):
            raise RuntimeError('Could not inspect eTIMS Windows access level')
        security.GetTokenInformation(token, 25, None, 0, ctypes.byref(size))
        if not size.value:
            raise RuntimeError('Could not inspect eTIMS Windows access level')
        label = ctypes.create_string_buffer(size.value)
        if not security.GetTokenInformation(token, 25, label, size.value, ctypes.byref(size)):
            raise RuntimeError('Could not inspect eTIMS Windows access level')
        sid = ctypes.cast(label, ctypes.POINTER(W.LPVOID))[0]
        count = security.GetSidSubAuthorityCount(sid)[0]
        integrity = security.GetSidSubAuthority(sid, count - 1)[0]
        if not kernel.ProcessIdToSessionId(pid, ctypes.byref(session)):
            raise RuntimeError('Could not inspect eTIMS Windows session')
        return dict(elevated=bool(elevated.value), integrity=integrity, session=session.value)
    finally:
        if token:
            kernel.CloseHandle(token)
        kernel.CloseHandle(process)


def is_elevated():
    return bool(os.name == 'nt' and ctypes.windll.shell32.IsUserAnAdmin())


def require_ui_access(pid):
    helper, target = process_access(os.getpid()), process_access(pid)
    if helper['session'] != target['session']:
        raise ValueError('eTIMS and the helper must run in the same signed-in Windows session')
    if helper['integrity'] < target['integrity']:
        raise ValueError('eTIMS is running as administrator but the helper has insufficient Windows access. Run Repair eTIMS Helper Access, approve the Windows administrator prompt, then Recover this same sale.')
