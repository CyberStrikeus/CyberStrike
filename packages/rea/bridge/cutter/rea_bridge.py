"""REA's experimental local bridge plugin for Cutter.

Install this file in Cutter's user plugin directory. The bridge is REA-owned
IPC, not an upstream Cutter transport. It binds to loopback and requires a
per-process random token stored in a user-only descriptor file.
"""

from __future__ import annotations

import json
import hashlib
import hmac
import os
import re
import secrets
import socket
import stat
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any

if os.name == "nt":
    import ctypes
    from ctypes import wintypes

import cutter

try:
    from PySide6.QtCore import QCoreApplication, QObject, Signal
except ImportError:
    from PySide2.QtCore import QCoreApplication, QObject, Signal


# Request and response frame budget in bytes, excluding the trailing LF.
# REA_BRIDGE_MAX_REQUEST_BYTES selects it. Unset stays 16777216.
# 7464 is the authenticated frame of the largest bounded symbol name.
# The 64-receipt recovery status is smaller with current_file null. A path
# that fits is kept. A path that does not fit is null, not the descriptor path.
# 536870887 is Node's 536870888-character string ceiling minus the framing LF.
# The ceiling is the encoded payload; JSON expansion is measured before it.
# A fitting response is signed from bounded JSON pieces and written in 64 KiB
# chunks, so this maximum does not retain several copies of the frame.
_BRIDGE_MAX_REQUEST_BYTES_SETTING = "REA_BRIDGE_MAX_REQUEST_BYTES"
DEFAULT_BRIDGE_MAX_REQUEST_BYTES = 16 * 1024 * 1024
MINIMUM_BRIDGE_MAX_REQUEST_BYTES = 7464
MAXIMUM_BRIDGE_MAX_REQUEST_BYTES = 536870887
# The outer authenticated frame around the escaped JSON payload, excluding LF.
_AUTHENTICATED_PREFIX = b'{"response":"'
_AUTHENTICATED_PROOF_MARK = b'","proof":"'
_PROOF_HEX_LENGTH = 64
_AUTHENTICATED_FRAME_OVERHEAD = (
    len(_AUTHENTICATED_PREFIX)
    + len(_AUTHENTICATED_PROOF_MARK)
    + _PROOF_HEX_LENGTH
    + len(b'"}')
)
_AUTHENTICATED_WRITE_BUFFER_BYTES = 64 * 1024
# Raw JSON is produced in pieces no larger than this many characters.
# One character expands to at most six JSON bytes (\u00XX) before the outer
# string escape, so a piece stays far below the frame ceiling.
_JSON_CHUNK_CHARS = 64 * 1024
# Fixed admission cap. It does not follow REA_BRIDGE_MAX_REQUEST_BYTES.
# A further accept is closed. Starting a worker must not stop the listener.
MAX_CONNECTION_WORKERS = 8


def _close_socket(connection: socket.socket) -> None:
    try:
        connection.close()
    except OSError:
        pass


def _bridge_max_request_bytes_constraint():
    return (
        "REA_BRIDGE_MAX_REQUEST_BYTES must be a positive decimal integer "
        "from %d to %d bytes; the default is %d bytes (16 MiB). "
        "A value below %d bytes cannot carry the largest admitted "
        "symbol-name command, and a larger value is refused so the encoded "
        "payload plus its framing LF stays one string under Node's "
        "single-string ceiling."
        % (
            MINIMUM_BRIDGE_MAX_REQUEST_BYTES,
            MAXIMUM_BRIDGE_MAX_REQUEST_BYTES,
            DEFAULT_BRIDGE_MAX_REQUEST_BYTES,
            MINIMUM_BRIDGE_MAX_REQUEST_BYTES,
        )
    )


def _parse_bridge_max_request_bytes(raw):
    """Refuse a non-decimal or out-of-range ceiling. Never fall back."""
    constraint = _bridge_max_request_bytes_constraint()
    if isinstance(raw, bool):
        raise RuntimeError(constraint)
    if isinstance(raw, int):
        value = raw
    elif isinstance(raw, str):
        # ASCII digits only. str.isdigit() accepts numerals such as U+0668
        # that the TypeScript setting rejects.
        if re.fullmatch(r"[1-9][0-9]*", raw) is None:
            raise RuntimeError(constraint)
        value = int(raw)
    else:
        raise RuntimeError(constraint)
    if (
        value < MINIMUM_BRIDGE_MAX_REQUEST_BYTES
        or value > MAXIMUM_BRIDGE_MAX_REQUEST_BYTES
    ):
        raise RuntimeError(constraint)
    return value


def _resolve_bridge_max_request_bytes():
    """Prefer an injected global, then the process environment, then 16 MiB."""
    injected = globals().get(_BRIDGE_MAX_REQUEST_BYTES_SETTING)
    if injected is not None:
        return _parse_bridge_max_request_bytes(injected), "setting"
    raw = os.environ.get(_BRIDGE_MAX_REQUEST_BYTES_SETTING)
    if raw is None:
        return DEFAULT_BRIDGE_MAX_REQUEST_BYTES, "default"
    return _parse_bridge_max_request_bytes(raw), "setting"


MAX_FRAME_BYTES, BRIDGE_MAX_REQUEST_BYTES_SOURCE = (
    _resolve_bridge_max_request_bytes()
)


def _bridge_max_request_bytes_recovery():
    return (
        "The effective REA_BRIDGE_MAX_REQUEST_BYTES value is %d bytes "
        "(source %s; default %d, floor %d, maximum %d). "
        "Set REA_BRIDGE_MAX_REQUEST_BYTES in the environment that starts REA "
        "to a decimal integer from %d to %d, then restart REA. "
        "Restart Hopper or Cutter from that same environment so the bridge "
        "uses this ceiling."
        % (
            MAX_FRAME_BYTES,
            BRIDGE_MAX_REQUEST_BYTES_SOURCE,
            DEFAULT_BRIDGE_MAX_REQUEST_BYTES,
            MINIMUM_BRIDGE_MAX_REQUEST_BYTES,
            MAXIMUM_BRIDGE_MAX_REQUEST_BYTES,
            MINIMUM_BRIDGE_MAX_REQUEST_BYTES,
            MAXIMUM_BRIDGE_MAX_REQUEST_BYTES,
        )
    )


def _frame_limit_exceeded():
    return ValueError(
        "frame-limit-exceeded: Bridge request exceeds the %d-byte payload limit. %s"
        % (MAX_FRAME_BYTES, _bridge_max_request_bytes_recovery())
    )


SOCKET_TIMEOUT_SECONDS = 20
AUTH_FRAME_TIMEOUT_SECONDS = 1
# The client request deadline. The authenticated frame read may use up to
# this long; it does not grow past it when the byte ceiling is raised.
REQUEST_DEADLINE_SECONDS = 25


def _authenticated_frame_timeout_seconds():
    """Time to hash and transfer one maximum-sized authenticated frame.

    The hello frame stays at one second. The following command frame is
    built only after that challenge, so its read budget follows the
    configured payload size, at one second per mebibyte, and never exceeds
    the 25 second client deadline.
    """
    mebibytes = (MAX_FRAME_BYTES + (1024 * 1024) - 1) // (1024 * 1024)
    return min(
        REQUEST_DEADLINE_SECONDS,
        max(AUTH_FRAME_TIMEOUT_SECONDS, mebibytes),
    )


MAX_DESCRIPTOR_BYTES = 64 * 1024
MAX_COMPLETION_RECEIPTS = 64


def _windows_api() -> tuple[Any, Any]:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.LocalFree.argtypes = [wintypes.HLOCAL]
    kernel32.LocalFree.restype = wintypes.HLOCAL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    kernel32.GetFileAttributesW.argtypes = [wintypes.LPCWSTR]
    kernel32.GetFileAttributesW.restype = wintypes.DWORD
    kernel32.CreateDirectoryW.argtypes = [wintypes.LPCWSTR, wintypes.LPVOID]
    kernel32.CreateDirectoryW.restype = wintypes.BOOL
    kernel32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                     wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel32.CreateFileW.restype = wintypes.HANDLE
    kernel32.WriteFile.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD,
                                   ctypes.POINTER(wintypes.DWORD), wintypes.LPVOID]
    kernel32.WriteFile.restype = wintypes.BOOL
    kernel32.FlushFileBuffers.argtypes = [wintypes.HANDLE]
    kernel32.FlushFileBuffers.restype = wintypes.BOOL
    kernel32.MoveFileExW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD]
    kernel32.MoveFileExW.restype = wintypes.BOOL
    kernel32.DeleteFileW.argtypes = [wintypes.LPCWSTR]
    kernel32.DeleteFileW.restype = wintypes.BOOL
    advapi32.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    advapi32.OpenProcessToken.restype = wintypes.BOOL
    advapi32.GetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID,
                                              wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    advapi32.GetTokenInformation.restype = wintypes.BOOL
    advapi32.ConvertSidToStringSidW.argtypes = [wintypes.LPVOID, ctypes.POINTER(wintypes.LPWSTR)]
    advapi32.ConvertSidToStringSidW.restype = wintypes.BOOL
    advapi32.GetNamedSecurityInfoW.argtypes = [wintypes.LPWSTR, ctypes.c_int, wintypes.DWORD,
                                                ctypes.POINTER(wintypes.LPVOID), ctypes.POINTER(wintypes.LPVOID),
                                                ctypes.POINTER(wintypes.LPVOID), ctypes.POINTER(wintypes.LPVOID),
                                                ctypes.POINTER(wintypes.LPVOID)]
    advapi32.GetNamedSecurityInfoW.restype = wintypes.DWORD
    advapi32.GetSecurityDescriptorControl.argtypes = [wintypes.LPVOID, ctypes.POINTER(wintypes.WORD),
                                                       ctypes.POINTER(wintypes.DWORD)]
    advapi32.GetSecurityDescriptorControl.restype = wintypes.BOOL
    advapi32.EqualSid.argtypes = [wintypes.LPVOID, wintypes.LPVOID]
    advapi32.EqualSid.restype = wintypes.BOOL
    advapi32.GetAclInformation.argtypes = [wintypes.LPVOID, wintypes.LPVOID, wintypes.DWORD, ctypes.c_int]
    advapi32.GetAclInformation.restype = wintypes.BOOL
    advapi32.GetAce.argtypes = [wintypes.LPVOID, wintypes.DWORD, ctypes.POINTER(wintypes.LPVOID)]
    advapi32.GetAce.restype = wintypes.BOOL
    advapi32.IsValidSid.argtypes = [wintypes.LPVOID]
    advapi32.IsValidSid.restype = wintypes.BOOL
    advapi32.GetLengthSid.argtypes = [wintypes.LPVOID]
    advapi32.GetLengthSid.restype = wintypes.DWORD
    advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [
        wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(wintypes.LPVOID), ctypes.POINTER(wintypes.DWORD),
    ]
    advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.restype = wintypes.BOOL
    return kernel32, advapi32


def _windows_user_sid_text() -> str:
    kernel32, advapi32 = _windows_api()
    token = wintypes.HANDLE()
    if not advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), 0x0008, ctypes.byref(token)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        required = wintypes.DWORD()
        advapi32.GetTokenInformation(token, 1, None, 0, ctypes.byref(required))
        if required.value == 0:
            raise ctypes.WinError(ctypes.get_last_error())
        buffer = ctypes.create_string_buffer(required.value)
        if not advapi32.GetTokenInformation(token, 1, buffer, required, ctypes.byref(required)):
            raise ctypes.WinError(ctypes.get_last_error())

        class SID_AND_ATTRIBUTES(ctypes.Structure):
            _fields_ = [("Sid", wintypes.LPVOID), ("Attributes", wintypes.DWORD)]

        class TOKEN_USER(ctypes.Structure):
            _fields_ = [("User", SID_AND_ATTRIBUTES)]

        sid = ctypes.cast(buffer, ctypes.POINTER(TOKEN_USER)).contents.User.Sid
        text = wintypes.LPWSTR()
        if not advapi32.ConvertSidToStringSidW(sid, ctypes.byref(text)):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            return text.value
        finally:
            kernel32.LocalFree(text)
    finally:
        kernel32.CloseHandle(token)


def _verify_windows_private_path(path: Path, directory: bool) -> None:
    kernel32, advapi32 = _windows_api()
    attributes = kernel32.GetFileAttributesW(str(path))
    if attributes == 0xFFFFFFFF:
        raise ctypes.WinError(ctypes.get_last_error())
    if attributes & 0x400 or bool(attributes & 0x10) != directory:
        raise RuntimeError("Cutter bridge path is a reparse point or has the wrong object type")

    class ACL_SIZE_INFORMATION(ctypes.Structure):
        _fields_ = [("AceCount", wintypes.DWORD), ("AclBytesInUse", wintypes.DWORD), ("AclBytesFree", wintypes.DWORD)]

    class ACE_HEADER(ctypes.Structure):
        _fields_ = [("AceType", wintypes.BYTE), ("AceFlags", wintypes.BYTE), ("AceSize", wintypes.WORD)]

    class SID_HEADER(ctypes.Structure):
        _fields_ = [("Revision", wintypes.BYTE), ("SubAuthorityCount", wintypes.BYTE),
                    ("IdentifierAuthority", wintypes.BYTE * 6)]

    class ACCESS_ALLOWED_ACE(ctypes.Structure):
        _fields_ = [("Header", ACE_HEADER), ("Mask", wintypes.DWORD), ("SidStart", wintypes.DWORD)]

    owner = wintypes.LPVOID()
    dacl = wintypes.LPVOID()
    descriptor = wintypes.LPVOID()
    result = advapi32.GetNamedSecurityInfoW(
        str(path), 1, 0x1 | 0x4, ctypes.byref(owner), None, ctypes.byref(dacl), None, ctypes.byref(descriptor),
    )
    if result != 0:
        raise ctypes.WinError(result)
    try:
        control = wintypes.WORD()
        revision = wintypes.DWORD()
        if not advapi32.GetSecurityDescriptorControl(descriptor, ctypes.byref(control), ctypes.byref(revision)):
            raise ctypes.WinError(ctypes.get_last_error())
        if not control.value & 0x1000 or not dacl:
            raise RuntimeError("Cutter bridge ACL must be present and protected from inheritance")

        token = wintypes.HANDLE()
        if not advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), 0x0008, ctypes.byref(token)):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            required = wintypes.DWORD()
            advapi32.GetTokenInformation(token, 1, None, 0, ctypes.byref(required))
            token_user = ctypes.create_string_buffer(required.value)
            if not advapi32.GetTokenInformation(token, 1, token_user, required, ctypes.byref(required)):
                raise ctypes.WinError(ctypes.get_last_error())

            class SID_AND_ATTRIBUTES(ctypes.Structure):
                _fields_ = [("Sid", wintypes.LPVOID), ("Attributes", wintypes.DWORD)]

            class TOKEN_USER(ctypes.Structure):
                _fields_ = [("User", SID_AND_ATTRIBUTES)]

            current_sid = ctypes.cast(token_user, ctypes.POINTER(TOKEN_USER)).contents.User.Sid
            if not advapi32.EqualSid(owner, current_sid):
                raise RuntimeError("Cutter bridge path owner does not match the current user")
        finally:
            kernel32.CloseHandle(token)

        info = ACL_SIZE_INFORMATION()
        if not advapi32.GetAclInformation(dacl, ctypes.byref(info), ctypes.sizeof(info), 2) or info.AceCount != 2:
            raise RuntimeError("Cutter bridge ACL must allow only the current user and SYSTEM")
        expected_user = _windows_user_sid_text()
        user_allowed = False
        system_allowed = False
        for index in range(info.AceCount):
            ace_pointer = wintypes.LPVOID()
            if not advapi32.GetAce(dacl, index, ctypes.byref(ace_pointer)):
                raise ctypes.WinError(ctypes.get_last_error())
            header = ctypes.cast(ace_pointer, ctypes.POINTER(ACE_HEADER)).contents
            if header.AceType != 0 or header.AceSize < ctypes.sizeof(ACE_HEADER) + ctypes.sizeof(wintypes.DWORD) + ctypes.sizeof(SID_HEADER):
                raise RuntimeError("Cutter bridge ACL contains a malformed or unsupported ACE")
            ace_address = ctypes.cast(ace_pointer, ctypes.c_void_p).value
            if ace_address is None:
                raise RuntimeError("Cutter bridge ACL returned a null ACE")
            sid_pointer = ctypes.c_void_p(ace_address + ctypes.sizeof(ACE_HEADER) + ctypes.sizeof(wintypes.DWORD))
            sid_header = ctypes.cast(sid_pointer, ctypes.POINTER(SID_HEADER)).contents
            sid_size = ctypes.sizeof(SID_HEADER) + sid_header.SubAuthorityCount * ctypes.sizeof(wintypes.DWORD)
            if sid_size > header.AceSize - ctypes.sizeof(ACE_HEADER) - ctypes.sizeof(wintypes.DWORD) or not advapi32.IsValidSid(sid_pointer) or advapi32.GetLengthSid(sid_pointer) != sid_size:
                raise RuntimeError("Cutter bridge ACL contains an invalid SID")
            ace = ctypes.cast(ace_pointer, ctypes.POINTER(ACCESS_ALLOWED_ACE)).contents
            sid_text = wintypes.LPWSTR()
            if ace.Mask != 0x001F01FF or ace.Header.AceFlags != 0x03:
                raise RuntimeError("Cutter bridge ACL contains an unsupported ACE")
            if not advapi32.ConvertSidToStringSidW(sid_pointer, ctypes.byref(sid_text)):
                raise ctypes.WinError(ctypes.get_last_error())
            try:
                if sid_text.value == expected_user:
                    user_allowed = True
                elif sid_text.value == "S-1-5-18":
                    system_allowed = True
                else:
                    raise RuntimeError("Cutter bridge ACL allows an unrelated principal")
            finally:
                kernel32.LocalFree(sid_text)
        if not user_allowed or not system_allowed:
            raise RuntimeError("Cutter bridge ACL must allow only the current user and SYSTEM")
    finally:
        kernel32.LocalFree(descriptor)


def _windows_security_attributes() -> tuple[Any, Any]:
    kernel32, advapi32 = _windows_api()
    sid = _windows_user_sid_text()
    sddl = f"O:{sid}G:{sid}D:P(A;OICI;FA;;;{sid})(A;OICI;FA;;;SY)"
    descriptor = wintypes.LPVOID()
    if not advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, ctypes.byref(descriptor), None):
        raise ctypes.WinError(ctypes.get_last_error())

    class SECURITY_ATTRIBUTES(ctypes.Structure):
        _fields_ = [("nLength", wintypes.DWORD), ("lpSecurityDescriptor", wintypes.LPVOID), ("bInheritHandle", wintypes.BOOL)]

    attributes = SECURITY_ATTRIBUTES(ctypes.sizeof(SECURITY_ATTRIBUTES), descriptor, False)
    return kernel32, (descriptor, attributes)


def _ensure_windows_bridge_directory(directory: Path) -> None:
    directory.parent.mkdir(parents=True, exist_ok=True)
    if not directory.exists():
        kernel32, (descriptor, attributes) = _windows_security_attributes()
        try:
            if not kernel32.CreateDirectoryW(str(directory), ctypes.byref(attributes)):
                error = ctypes.get_last_error()
                if error != 183:
                    raise ctypes.WinError(error)
        finally:
            kernel32.LocalFree(descriptor)
    _verify_windows_private_path(directory, True)


def _ensure_posix_bridge_directory(directory: Path) -> None:
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY"):
        raise RuntimeError("Cutter bridge directory requires no-follow directory handles")
    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        directory_info = os.fstat(descriptor)
        if directory_info.st_uid != os.getuid():
            raise RuntimeError("Cutter bridge directory must be owned by the current user")
        os.fchmod(descriptor, 0o700)
        directory_info = os.fstat(descriptor)
        if stat.S_IMODE(directory_info.st_mode) != 0o700:
            raise RuntimeError("Cutter bridge directory must have mode 0700")
    finally:
        os.close(descriptor)


def _write_windows_descriptor(directory: Path, destination: Path, payload: bytes) -> None:
    if len(payload) > MAX_DESCRIPTOR_BYTES:
        raise RuntimeError("Cutter bridge descriptor exceeds its byte limit")
    kernel32, (security_descriptor, attributes) = _windows_security_attributes()
    temporary = directory / f".{destination.name}.{uuid.uuid4().hex}.tmp"
    handle = wintypes.HANDLE()
    try:
        handle = kernel32.CreateFileW(str(temporary), 0x40000000 | 0x00020000 | 0x00040000,
                                      0x1 | 0x2 | 0x4, ctypes.byref(attributes), 1, 0x80, None)
        if handle == wintypes.HANDLE(-1).value:
            raise ctypes.WinError(ctypes.get_last_error())
        _verify_windows_private_path(temporary, False)
        if payload:
            data = ctypes.create_string_buffer(payload)
            written = wintypes.DWORD()
            if not kernel32.WriteFile(handle, data, len(payload), ctypes.byref(written), None) or written.value != len(payload):
                raise ctypes.WinError(ctypes.get_last_error())
        if not kernel32.FlushFileBuffers(handle):
            raise ctypes.WinError(ctypes.get_last_error())
        kernel32.CloseHandle(handle)
        handle = wintypes.HANDLE()
        if not kernel32.MoveFileExW(str(temporary), str(destination), 0x1 | 0x8):
            raise ctypes.WinError(ctypes.get_last_error())
    finally:
        if handle and handle != wintypes.HANDLE(-1).value:
            kernel32.CloseHandle(handle)
        kernel32.DeleteFileW(str(temporary))
        kernel32.LocalFree(security_descriptor)


def _bridge_directory() -> Path:
    configured = os.environ.get("REA_CUTTER_BRIDGE_DIR")
    if configured:
        return Path(configured).expanduser()
    local_app_data = os.environ.get("LOCALAPPDATA")
    if os.name == "nt" and local_app_data:
        return Path(local_app_data) / "REA" / "CutterBridge"
    return Path.home() / ".cache" / "rea" / "cutter-bridge"


class _RequestDispatcher(QObject):
    dispatch = Signal(object, object)

    def __init__(self) -> None:
        super().__init__()
        self.dispatch.connect(self._handle)
        self.generation = 0
        self.completed_commands: dict[str, str] = {}
        self._receipt_lock = threading.Lock()
        self.current_file = self._read_current_file()
        try:
            value = QCoreApplication.applicationVersion()
            self.cutter_version = value if isinstance(value, str) and value else None
        except Exception:
            self.cutter_version = None

    @staticmethod
    def _read_current_file() -> str | None:
        try:
            value = cutter.core().getConfig("file.path")
            return value if isinstance(value, str) and value else None
        except Exception:
            return None

    def _handle(self, request: dict[str, Any], reply: dict[str, Any]) -> None:
        kind = request.get("kind")
        request_id = request.get("request_id")
        if kind in ("command", "ack"):
            try:
                valid_request_id = (
                    isinstance(request_id, str)
                    and str(uuid.UUID(request_id)) == request_id.lower()
                )
            except (ValueError, AttributeError):
                valid_request_id = False
            if not valid_request_id:
                reply.update({
                    "ok": False,
                    "error": "invalid-command-request-id",
                    "execution_state": "not_started",
                })
                request["_event"].set()
                return
        if kind == "ack":
            with self._receipt_lock:
                acknowledged = self.completed_commands.pop(request_id, None) is not None
            reply.update({"ok": True, "acknowledged": acknowledged})
            request["_event"].set()
            return
        if request["_cancelled"].is_set():
            reply.update({
                "ok": False,
                "error": "request-cancelled-before-execution",
                "execution_state": "not_started",
            })
            if kind == "command":
                self._record_command_completion(request_id, "not_started")
            request["_event"].set()
            return
        self._refresh_document_identity()
        if kind == "status":
            with self._receipt_lock:
                completed_commands = [
                    {"request_id": receipt_id, "execution_state": state}
                    for receipt_id, state in self.completed_commands.items()
                ]
            reply.update({
                "ok": True,
                "session_id": request.get("session_id"),
                "current_file": self.current_file,
                "document_generation": self.generation,
                "cutter_version": self.cutter_version,
                "identity_status": "partial",
                "completed_commands": completed_commands,
            })
            request["_event"].set()
            return
        if kind != "command":
            reply.update({"ok": False, "error": "unsupported-request-kind"})
            request["_event"].set()
            return
        if request.get("expected_generation") != self.generation:
            reply.update({
                "ok": False,
                "error": "active-document-generation-changed",
                "execution_state": "not_started",
            })
            self._record_command_completion(request_id, "not_started")
            request["_event"].set()
            return
        command = request.get("command")
        if not isinstance(command, str) or not command.strip():
            reply.update({
                "ok": False,
                "error": "invalid-command",
                "execution_state": "not_started",
            })
            self._record_command_completion(request_id, "not_started")
            request["_event"].set()
            return
        reply["execution_state"] = "running"
        try:
            output = cutter.cmdj(command) if request.get("json") is True else cutter.cmd(command)
            command_error = None
        except Exception as error:
            output = None
            command_error = str(error)
        self._refresh_document_identity()
        if command_error is None:
            reply.update({
                "ok": True,
                "output": output,
                "current_file": self.current_file,
                "document_generation": self.generation,
                "cutter_version": self.cutter_version,
                "identity_status": "partial",
                "execution_state": "complete",
            })
            self._record_command_completion(request_id, "complete")
        else:
            reply.update({
                "ok": False,
                "error": command_error,
                "current_file": self.current_file,
                "document_generation": self.generation,
                "cutter_version": self.cutter_version,
                "identity_status": "partial",
                "execution_state": "unknown",
                "message": "The command raised an exception; it may have produced partial effects. Do not retry automatically.",
            })
            self._record_command_completion(request_id, "failed")
        request["_event"].set()

    def _record_command_completion(
        self, request_id: str, execution_state: str
    ) -> None:
        with self._receipt_lock:
            if request_id in self.completed_commands or len(self.completed_commands) < MAX_COMPLETION_RECEIPTS:
                self.completed_commands[request_id] = execution_state

    def can_accept_command(self) -> bool:
        with self._receipt_lock:
            return len(self.completed_commands) < MAX_COMPLETION_RECEIPTS

    def _refresh_document_identity(self) -> None:
        current_file = self._read_current_file()
        if current_file != self.current_file:
            self.current_file = current_file
            self.generation += 1


class _BridgeServer(threading.Thread):
    def __init__(self, dispatcher: _RequestDispatcher) -> None:
        super().__init__(name="rea-cutter-bridge", daemon=True)
        self.dispatcher = dispatcher
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(8)
        self.server.settimeout(0.5)
        self.port = self.server.getsockname()[1]
        self.session_id = str(uuid.uuid4())
        self.token = secrets.token_urlsafe(32)
        self.poisoned = False
        self.connection_ordinal = 0
        # The client proof is inside the authenticated frame, so that read
        # cannot start after proof. It runs off the accept loop. One
        # authenticated command still runs at a time. completed_connection
        # is the longest prefix of these ordinals whose handlers have
        # terminated, not "this status ordinal minus one".
        self._command_lock = threading.Lock()
        self._connections_lock = threading.Lock()
        self._connections: set[socket.socket] = set()
        self._workers: list[threading.Thread] = []
        self._finished_through = 0
        self._finished_ordinals: set[int] = set()
        self.directory = _bridge_directory()
        self.descriptor = self.directory / f"cutter-{os.getpid()}-{self.session_id}.json"

    def publish(self) -> None:
        if os.name == "nt":
            _ensure_windows_bridge_directory(self.directory)
        else:
            _ensure_posix_bridge_directory(self.directory)
        if os.name == "nt" and (self.directory.is_symlink() or not self.directory.is_dir()):
            raise RuntimeError("Cutter bridge directory must be a real directory")
        payload = {
            "session_id": self.session_id,
            "pid": os.getpid(),
            "host": "127.0.0.1",
            "port": self.port,
            "token": self.token,
            "document_generation": self.dispatcher.generation,
            "current_file": self.dispatcher.current_file,
            "cutter_version": self.dispatcher.cutter_version,
            "identity_status": "partial",
            "max_request_bytes": MAX_FRAME_BYTES,
        }
        if os.name == "nt":
            _write_windows_descriptor(self.directory, self.descriptor, json.dumps(payload).encode("utf-8"))
            return
        descriptor, temporary_path = tempfile.mkstemp(prefix=f".{self.descriptor.name}.", dir=self.directory)
        try:
            os.fchmod(descriptor, 0o600)
            descriptor_info = os.fstat(descriptor)
            if descriptor_info.st_uid != os.getuid() or stat.S_IMODE(descriptor_info.st_mode) & 0o077:
                raise RuntimeError("Cutter bridge descriptor must be owned by the current user with mode 0600")
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                stream.write(json.dumps(payload))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary_path, self.descriptor)
        except Exception:
            try:
                os.close(descriptor)
            except OSError:
                pass
            try:
                os.unlink(temporary_path)
            except OSError:
                pass
            raise

    def run(self) -> None:
        try:
            self.publish()
        except Exception:
            self.server.close()
            return
        while True:
            try:
                connection, _ = self.server.accept()
            except socket.timeout:
                if getattr(self, "stopping", False):
                    break
                continue
            except OSError:
                break
            with self._connections_lock:
                self._workers = [
                    worker for worker in self._workers if worker.is_alive()
                ]
                at_capacity = len(self._workers) >= MAX_CONNECTION_WORKERS
            if at_capacity:
                _close_socket(connection)
                continue
            self.connection_ordinal += 1
            connection_ordinal = self.connection_ordinal
            worker = threading.Thread(
                target=self._serve_connection,
                args=(connection, connection_ordinal),
                name="rea-cutter-bridge-connection",
                daemon=True,
            )
            with self._connections_lock:
                self._connections.add(connection)
                self._workers.append(worker)
            try:
                worker.start()
            except RuntimeError:
                with self._connections_lock:
                    self._connections.discard(connection)
                    if worker in self._workers:
                        self._workers.remove(worker)
                self._note_connection_finished(connection_ordinal)
                _close_socket(connection)
        with self._connections_lock:
            workers = list(self._workers)
        for worker in workers:
            worker.join(timeout=1)
        self.server.close()
        try:
            self.descriptor.unlink(missing_ok=True)
        except OSError:
            pass

    def _serve_connection(self, connection: socket.socket, connection_ordinal: int) -> None:
        try:
            with connection:
                connection.settimeout(AUTH_FRAME_TIMEOUT_SECONDS)
                authenticated = False
                try:
                    hello = self._receive_frame(connection)
                    if not isinstance(hello, dict) or hello.get("kind") != "rea-auth-v2" or not isinstance(hello.get("nonce"), str) or len(hello["nonce"]) != 64:
                        self._send(connection, {"ok": False, "error": "authentication-failed"})
                        return
                    client_nonce = hello["nonce"]
                    server_nonce = f"{connection_ordinal:016x}{secrets.token_hex(24)}"
                    server_proof = hmac.new(self.token.encode(), f"rea-cutter-server-v2:{self.session_id}:{client_nonce}:{server_nonce}".encode(), hashlib.sha256).hexdigest()
                    self._send(connection, {"session_id": self.session_id, "nonce": server_nonce, "proof": server_proof})
                    authenticated_frame = self._receive_frame(
                        connection, _authenticated_frame_timeout_seconds()
                    )
                    request_bytes = authenticated_frame.get("request") if isinstance(authenticated_frame, dict) else None
                    presented_proof = authenticated_frame.get("proof") if isinstance(authenticated_frame, dict) else None
                    if not isinstance(request_bytes, str) or not isinstance(presented_proof, str):
                        self._send(connection, {"ok": False, "error": "authentication-failed"})
                        return
                    # Update the prefix and the request separately. One joined
                    # preimage would retain another copy of a maximum-sized command.
                    expected_proof = hmac.new(self.token.encode(), digestmod=hashlib.sha256)
                    expected_proof.update(
                        f"rea-cutter-client-v2:{self.session_id}:{client_nonce}:{server_nonce}:".encode()
                    )
                    expected_proof.update(request_bytes.encode())
                    if not hmac.compare_digest(presented_proof, expected_proof.hexdigest()):
                        self._send(connection, {"ok": False, "error": "authentication-failed"})
                        return
                    request = json.loads(request_bytes)
                    if not isinstance(request, dict) or request.get("session_id") != self.session_id:
                        self._send(connection, {"ok": False, "error": "authentication-failed"})
                        return
                    authenticated = True
                    with self._command_lock:
                        connection.settimeout(SOCKET_TIMEOUT_SECONDS)
                        if self.poisoned and request.get("kind") not in ("status", "ack"):
                            self._send_authenticated(connection, {
                                "ok": False,
                                "error": "session-poisoned-after-ui-timeout",
                                "execution_state": "not_started",
                            }, client_nonce, server_nonce)
                            return
                        if (
                            request.get("kind") == "command"
                            and not self.dispatcher.can_accept_command()
                        ):
                            self._send_authenticated(connection, {
                                "ok": False,
                                "error": "completion-receipt-capacity-exceeded",
                                "execution_state": "not_started",
                            }, client_nonce, server_nonce)
                            return
                        request["session_id"] = self.session_id
                        event = threading.Event()
                        cancelled = threading.Event()
                        reply: dict[str, Any] = {}
                        request["_event"] = event
                        request["_cancelled"] = cancelled
                        self.dispatcher.dispatch.emit(request, reply)
                        if not event.wait(SOCKET_TIMEOUT_SECONDS):
                            cancelled.set()
                            self.poisoned = True
                            self._send_authenticated(connection, {
                                "ok": False,
                                "error": "ui-thread-request-timeout",
                                "execution_state": "unknown",
                                "message": "The UI operation may still complete after this timeout; restart Cutter before issuing further commands.",
                            }, client_nonce, server_nonce)
                        else:
                            if request.get("kind") == "status" and reply.get("ok") is True:
                                reply["completed_connection"] = self._completion_watermark()
                            self._send_authenticated(connection, reply, client_nonce, server_nonce)
                except socket.timeout:
                    if authenticated:
                        self._send_authenticated(connection, {
                            "ok": False,
                            "error": "request-timeout",
                            "execution_state": "unknown",
                            "message": "The command may have produced partial or persistent effects. Do not retry automatically.",
                        }, client_nonce, server_nonce)
                except Exception as error:
                    self._send(connection, {"ok": False, "error": str(error)})
        finally:
            self._note_connection_finished(connection_ordinal)
            with self._connections_lock:
                self._connections.discard(connection)

    def _note_connection_finished(self, ordinal: int) -> None:
        """Record one accepted connection as terminated.

        The watermark is the longest prefix 1..W that has terminated. A later
        status cannot report an earlier connection that is still reading or
        still waiting to run.
        """
        with self._connections_lock:
            if ordinal <= self._finished_through or ordinal in self._finished_ordinals:
                return
            self._finished_ordinals.add(ordinal)
            while self._finished_through + 1 in self._finished_ordinals:
                self._finished_through += 1
                self._finished_ordinals.discard(self._finished_through)

    def _completion_watermark(self) -> str:
        with self._connections_lock:
            return f"{self._finished_through:016x}"

    @staticmethod
    def _receive_frame(
        connection: socket.socket,
        timeout_seconds: float = AUTH_FRAME_TIMEOUT_SECONDS,
    ) -> dict[str, Any]:
        data = bytearray()
        deadline = time.monotonic() + timeout_seconds
        newline = -1
        while newline < 0:
            if len(data) > MAX_FRAME_BYTES:
                raise _frame_limit_exceeded()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise socket.timeout("authentication frame timed out")
            connection.settimeout(remaining)
            # MAX_FRAME_BYTES limits the JSON payload; the terminating LF is
            # framing and may be the one byte beyond that payload budget.
            part = connection.recv(min(65536, MAX_FRAME_BYTES + 1 - len(data)))
            if not part:
                raise ValueError("incomplete authentication frame")
            scanned = len(data)
            data.extend(part)
            # The delimiter is one byte, so it cannot straddle a chunk.
            # Search only the bytes just received.
            newline = data.find(b"\n", scanned)
        if newline > MAX_FRAME_BYTES:
            raise _frame_limit_exceeded()
        if newline != len(data) - 1:
            raise ValueError("invalid framed request")
        value = json.loads(bytes(data[:newline]))
        return value if isinstance(value, dict) else {}

    def _send_authenticated(self, connection: socket.socket, value: dict[str, Any], client_nonce: str, server_nonce: str) -> None:
        if self._deliver_authenticated(connection, value, client_nonce, server_nonce):
            return
        # Keep the recovery payload. Include the observed path when it
        # fits. An explicit null path means unknown, so the client does
        # not pair this generation with the descriptor's older path.
        bounded = self._bounded_status_response(value)
        if bounded is not None:
            observed_path = value.get("current_file")
            if isinstance(observed_path, str) and observed_path:
                with_path = dict(bounded)
                with_path["current_file"] = observed_path
                with_path.pop("message", None)
                if self._deliver_authenticated(
                    connection, with_path, client_nonce, server_nonce
                ):
                    return
            if self._deliver_authenticated(
                connection, bounded, client_nonce, server_nonce
            ):
                return
        command = self._bounded_command_response(value)
        if command is not None:
            observed_path = value.get("current_file")
            if isinstance(observed_path, str) and observed_path:
                with_path = dict(command)
                with_path["current_file"] = observed_path
                with_path.pop("message", None)
                if self._deliver_authenticated(
                    connection, with_path, client_nonce, server_nonce
                ):
                    return
            if self._deliver_authenticated(
                connection, command, client_nonce, server_nonce
            ):
                return
        value = self._truncated_response(value)
        if self._deliver_authenticated(connection, value, client_nonce, server_nonce):
            return
        # This fixed-size fallback is checked through the same signed framing path.
        self._deliver_authenticated(connection, {
            "ok": False,
            "error": "response-limit-exceeded",
            "execution_state": value.get("execution_state", "unknown"),
            "output": None,
            "output_truncated": True,
            "message": "The result exceeded the bridge frame limit; command completion state is preserved.",
        }, client_nonce, server_nonce)

    def _deliver_authenticated(
        self, connection: socket.socket, value: dict[str, Any], client_nonce: str, server_nonce: str
    ) -> bool:
        proof = self._authenticated_proof(value, client_nonce, server_nonce)
        if proof is None:
            return False
        try:
            self._write_authenticated_frame(connection, value, proof)
        except OSError:
            # A disconnected caller must not fall through to another payload.
            pass
        return True

    def _authenticated_proof(
        self, value: dict[str, Any], client_nonce: str, server_nonce: str
    ) -> str | None:
        if not _within_response_limit(value):
            return None
        # The payload budget excludes the terminating LF. Fragments are
        # measured and signed here, then discarded. The write pass encodes
        # them again so a maximum-sized reply is not held in several copies.
        frame_size = _AUTHENTICATED_FRAME_OVERHEAD
        proof = hmac.new(self.token.encode(), digestmod=hashlib.sha256)
        proof.update(
            f"rea-cutter-response-v2:{self.session_id}:{client_nonce}:{server_nonce}:".encode()
        )
        for fragment in _response_fragments(value):
            frame_size += len(_escape_json_fragment(fragment))
            if frame_size > MAX_FRAME_BYTES:
                return None
            proof.update(fragment.encode("utf-8"))
        return proof.hexdigest()

    def _encode_authenticated_response(
        self, value: dict[str, Any], client_nonce: str, server_nonce: str
    ) -> bytes | None:
        """Return one exact frame. The socket path writes the same pieces."""
        proof = self._authenticated_proof(value, client_nonce, server_nonce)
        if proof is None:
            return None
        return b"".join(self._iter_authenticated_frame(value, proof))

    def _iter_authenticated_frame(self, value: dict[str, Any], proof: str):
        yield _AUTHENTICATED_PREFIX
        for fragment in _response_fragments(value):
            yield _escape_json_fragment(fragment)
        yield _AUTHENTICATED_PROOF_MARK + proof.encode("ascii") + b'"}\n'

    def _write_authenticated_frame(
        self, connection: socket.socket, value: dict[str, Any], proof: str
    ) -> None:
        pending = bytearray()
        for chunk in self._iter_authenticated_frame(value, proof):
            pending.extend(chunk)
            if len(pending) >= _AUTHENTICATED_WRITE_BUFFER_BYTES:
                connection.sendall(pending)
                pending.clear()
        if pending:
            connection.sendall(pending)

    @staticmethod
    def _bounded_status_response(value: dict[str, Any]) -> dict[str, Any] | None:
        if "completed_commands" not in value and "completed_connection" not in value:
            return None
        bounded: dict[str, Any] = {
            "ok": value.get("ok") is True,
            "session_id": value.get("session_id"),
            "document_generation": value.get("document_generation"),
            "identity_status": value.get("identity_status", "partial"),
            "completed_commands": value.get("completed_commands"),
            "current_file": None,
            "message": (
                "current_file is unknown because the status frame exceeded "
                "REA_BRIDGE_MAX_REQUEST_BYTES. Do not reuse an older descriptor "
                "path with this document_generation."
            ),
        }
        if "completed_connection" in value:
            bounded["completed_connection"] = value["completed_connection"]
        return bounded

    @staticmethod
    def _bounded_command_response(value: dict[str, Any]) -> dict[str, Any] | None:
        if "execution_state" not in value and "document_generation" not in value:
            return None
        bounded: dict[str, Any] = {
            "ok": value.get("ok") is True,
            "output": None,
            "execution_state": value.get("execution_state", "unknown"),
            "output_truncated": True,
            "current_file": None,
            "message": (
                "current_file is unknown because the result frame exceeded "
                "REA_BRIDGE_MAX_REQUEST_BYTES. The command completion state and "
                "document_generation are preserved. Do not reuse an older "
                "descriptor path with this document_generation."
            ),
        }
        generation = value.get("document_generation")
        if isinstance(generation, int) and not isinstance(generation, bool):
            bounded["document_generation"] = generation
        if value.get("identity_status") == "partial":
            bounded["identity_status"] = "partial"
        if value.get("ok") is not True and isinstance(value.get("error"), str):
            bounded["error"] = value["error"]
        return bounded

    @staticmethod
    def _truncated_response(value: dict[str, Any]) -> dict[str, Any]:
        response: dict[str, Any] = {
            "ok": value.get("ok") is True,
            "output": None,
            "execution_state": value.get("execution_state", "unknown"),
            "output_truncated": True,
            "message": "The command result exceeded the bridge frame limit; completion state is preserved and output was omitted.",
        }
        for key in ("current_file", "document_generation", "cutter_version", "identity_status"):
            if key in value:
                response[key] = value[key]
        if value.get("ok") is not True and isinstance(value.get("error"), str):
            response["error"] = value["error"]
        return response

    @staticmethod
    def _send(connection: socket.socket, value: dict[str, Any]) -> None:
        if not _within_response_limit(value):
            value = {
                "ok": False,
                "error": "response-limit-exceeded",
                "execution_state": value.get("execution_state", "unknown"),
                "output_truncated": True,
                "message": "The command completed or may have completed, but its result exceeded the bridge response limit. Do not retry automatically.",
            }
        parts: list[bytes] = []
        encoded_size = 0
        for part in json.JSONEncoder(ensure_ascii=False).iterencode(value):
            encoded_part = part.encode("utf-8")
            encoded_size += len(encoded_part)
            if encoded_size > MAX_FRAME_BYTES:
                fallback = {
                    "ok": False,
                    "error": "response-limit-exceeded",
                    "execution_state": value.get("execution_state", "unknown"),
                    "output_truncated": True,
                    "message": "The command completed or may have completed, but its result exceeded the bridge response limit. Do not retry automatically.",
                }
                parts = [json.dumps(fallback, separators=(",", ":")).encode("utf-8")]
                break
            parts.append(encoded_part)
        encoded = b"".join(parts)
        try:
            connection.sendall(encoded + b"\n")
        except OSError:
            # A disconnected caller must not terminate the bridge thread or
            # prevent later commands from being served.
            pass

    def stop(self) -> None:
        self.stopping = True
        try:
            self.server.close()
        except OSError:
            pass
        with self._connections_lock:
            connections = list(self._connections)
        for connection in connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                connection.close()
            except OSError:
                pass


class ReaCutterPlugin(cutter.CutterPlugin):
    name = "REA Local Bridge"
    description = "Local REA analysis bridge for the active Cutter session"
    version = "1.0"
    author = "REA"

    def __init__(self) -> None:
        super().__init__()
        self._dispatcher: _RequestDispatcher | None = None
        self._bridge: _BridgeServer | None = None

    def setupPlugin(self) -> None:
        return

    def setupInterface(self, main: Any) -> None:
        self._dispatcher = _RequestDispatcher()
        self._bridge = _BridgeServer(self._dispatcher)
        self._bridge.start()

    def terminate(self) -> None:
        if self._bridge is not None:
            self._bridge.stop()
            self._bridge.join(timeout=2)
            self._bridge = None
        self._dispatcher = None


def create_cutter_plugin() -> ReaCutterPlugin:
    return ReaCutterPlugin()


def _json_object_key(key: Any) -> str:
    """Match CPython's JSON object-key text before quoting."""
    if isinstance(key, str):
        return key
    if key is True:
        return "true"
    if key is False:
        return "false"
    if key is None:
        return "null"
    if isinstance(key, int):
        return str(key)
    if isinstance(key, float):
        return json.dumps(key, separators=(",", ":"))
    raise TypeError("keys must be str, int, float, bool or None")


def _response_fragments(value: Any):
    """Yield compact JSON pieces whose concatenation is the encoded value.

    String contents are sliced before encoding so a large output never becomes
    one frame-sized fragment. Each piece is at most ``_JSON_CHUNK_CHARS``
    characters, or the six-byte ``\\u00XX`` expansion of one such slice.
    """
    if isinstance(value, str):
        yield '"'
        for start in range(0, len(value), _JSON_CHUNK_CHARS):
            yield json.dumps(
                value[start:start + _JSON_CHUNK_CHARS], ensure_ascii=False
            )[1:-1]
        yield '"'
        return
    if isinstance(value, dict):
        yield "{"
        first = True
        for key, item in value.items():
            if not first:
                yield ","
            first = False
            yield from _response_fragments(_json_object_key(key))
            yield ":"
            yield from _response_fragments(item)
        yield "}"
        return
    if isinstance(value, (list, tuple)):
        yield from _list_fragments(value)
        return
    token = _scalar_token(value)
    if token is None:
        raise TypeError("response value is not JSON")
    yield token


def _scalar_token(value: Any) -> str | None:
    """Compact JSON for one scalar. None means the value needs structure."""
    if type(value) is int:
        return str(value)
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, float):
        return json.dumps(value, separators=(",", ":"))
    return None


def _list_fragments(value: list[Any] | tuple[Any, ...]):
    """Encode a list, batching scalars into bounded pieces.

    One ``json.dumps`` per number makes a dense array miss the client
    deadline. A batch is at most ``_JSON_CHUNK_CHARS`` of compact JSON.
    """
    yield "["
    first = True
    batch: list[str] = []
    batch_len = 0

    def flush_batch() -> str | None:
        nonlocal first, batch, batch_len
        if not batch:
            return None
        piece = ",".join(batch)
        batch = []
        batch_len = 0
        if first:
            first = False
            return piece
        return "," + piece

    for item in value:
        token = _scalar_token(item)
        if token is None:
            emitted = flush_batch()
            if emitted is not None:
                yield emitted
            if first:
                first = False
            else:
                yield ","
            yield from _response_fragments(item)
            continue
        extra = len(token) if not batch else len(token) + 1
        if batch and batch_len + extra > _JSON_CHUNK_CHARS:
            emitted = flush_batch()
            if emitted is not None:
                yield emitted
            extra = len(token)
        batch.append(token)
        batch_len += extra
    emitted = flush_batch()
    if emitted is not None:
        yield emitted
    yield "]"


def _escape_json_fragment(fragment: str) -> bytes:
    """Escape one raw JSON piece for the outer response string."""
    return json.dumps(fragment, ensure_ascii=False)[1:-1].encode("utf-8")


def _within_response_limit(value: Any) -> bool:
    pending = [value]
    seen: set[int] = set()
    size = 0
    while pending:
        current = pending.pop()
        if isinstance(current, str):
            size += 2
            if len(current) > MAX_FRAME_BYTES - size:
                return False
            if current.isascii():
                size += len(current)
            else:
                # Count UTF-8 bytes without allocating a copy of the whole output.
                try:
                    size += sum(
                        len(current[start:start + 65536].encode("utf-8"))
                        for start in range(0, len(current), 65536)
                    )
                except UnicodeEncodeError:
                    # Unencodable output also needs the signed omission fallback.
                    return False
            size += current.count('"') + current.count("\\")
            # A short escape is two JSON bytes and was already counted as one.
            # Other controls expand to a six-byte \\u00XX sequence.
            size += sum(
                1 if ord(character) in (0x08, 0x09, 0x0A, 0x0C, 0x0D) else 5
                for character in current
                if ord(character) < 0x20
            )
        elif isinstance(current, dict):
            identity = id(current)
            if identity in seen:
                return False
            seen.add(identity)
            count = len(current)
            # Braces, one colon per entry, and commas between entries.
            # Keys and values are counted when they are visited.
            size += 2 + count + max(0, count - 1)
            if size > MAX_FRAME_BYTES:
                return False
            pending.extend(current.keys())
            pending.extend(current.values())
        elif isinstance(current, (list, tuple)):
            identity = id(current)
            if identity in seen:
                return False
            seen.add(identity)
            count = len(current)
            # Brackets and commas between items. Each item is counted below.
            size += 2 + max(0, count - 1)
            if size > MAX_FRAME_BYTES:
                return False
            pending.extend(current)
        elif current is None:
            size += 4
        elif current is True:
            size += 4
        elif current is False:
            size += 5
        elif isinstance(current, int):
            size += len(str(current))
        elif isinstance(current, float):
            size += len(json.dumps(current, separators=(",", ":")))
        else:
            try:
                size += len(
                    json.dumps(current, ensure_ascii=False, separators=(",", ":"))
                )
            except (TypeError, ValueError):
                return False
        if size > MAX_FRAME_BYTES:
            return False
    return True
