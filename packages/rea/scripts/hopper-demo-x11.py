#!/usr/bin/env python3
"""Inspect or activate Hopper's authenticated demo dialog on a private X display."""

from __future__ import annotations

import argparse
from collections.abc import Callable
import ctypes
import hashlib
import json
import os
import re
from pathlib import Path
import secrets
import select
import stat
import subprocess
import tempfile
import threading
import time


EXPECTED_SCREEN = (1280, 1024)
DIALOG_TITLES = {"Registration", "Registration — Hopper Disassembler"}
HOPPER_WINDOW_TITLE = "Hopper Disassembler"
DEMO_CLICK_LEFT = 116
DEMO_CLICK_BOTTOM = 22
PRIVATE_DISPLAY_UNAVAILABLE = 70
X11_AUTHORIZATION_FAILED = 71
UNSUPPORTED_HOPPER_BUILD = 72
INVALID_LAUNCH_COMMAND = 73
PROCESS_OWNERSHIP_MISMATCH = 74
HOPPER_EXITED_DURING_STARTUP = 75
UNSUPPORTED_DEMO_DIALOG = 76
UNEXPECTED_DISPLAY_GEOMETRY = 77
X11_INPUT_FAILED = 78
RUNTIME_DEPENDENCY_UNAVAILABLE = 79
X11_SOCKET_DIRECTORY_UNUSABLE = 80
DEMO_DIALOG_ABSENT = 81
INVALID_DIALOG_TIMEOUT = 82
DEFAULT_DIALOG_TIMEOUT_MS = 10_000
DIALOG_TIMEOUT_MINIMUM_MS = 1
# Node schedules a delay above this signed 32-bit bound as 1 ms. Keep the
# watcher on the same ceiling as REA's other millisecond settings.
DIALOG_TIMEOUT_MAXIMUM_MS = 2_147_483_647
DIALOG_TIMEOUT_ENV = "REA_HOPPER_DEMO_DIALOG_TIMEOUT_MS"
DIAGNOSTIC_PREFIX = "REA_X11_DIAGNOSTIC="
X11_SOCKET_DIRECTORY = Path("/tmp/.X11-unix")
class AdapterFailure(Exception):
    def __init__(
        self,
        code: int,
        reason: str,
        message: str,
        stderr_bytes: int = 0,
        dialog_timeout: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.reason = reason
        self.stderr_bytes = stderr_bytes
        self.dialog_timeout = dialog_timeout

    def with_stderr(self, capture: CapturedStderr) -> AdapterFailure:
        self.stderr_bytes, _ = capture.snapshot()
        return self


class DemoWatchStop(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class CapturedStderr:
    def __init__(self, stream: object) -> None:
        self._stream = stream
        self._retained = bytearray()
        self._bytes = 0
        self._lock = threading.Lock()
        self._thread = threading.Thread(target=self._drain, daemon=True)
        self._thread.start()

    def _drain(self) -> None:
        while True:
            chunk = self._stream.read(4096)
            if not chunk:
                return
            with self._lock:
                self._bytes += len(chunk)
                self._retained.extend(chunk)

    def snapshot(self) -> tuple[int, str]:
        with self._lock:
            retained = bytes(self._retained)
            total = self._bytes
        return total, retained.decode("utf-8", "replace")

    def close(self) -> None:
        self._thread.join(timeout=0.5)


class XWindowAttributes(ctypes.Structure):
    _fields_ = [
        ("x", ctypes.c_int),
        ("y", ctypes.c_int),
        ("width", ctypes.c_int),
        ("height", ctypes.c_int),
        ("border_width", ctypes.c_int),
        ("depth", ctypes.c_int),
        ("visual", ctypes.c_void_p),
        ("root", ctypes.c_ulong),
        ("class_", ctypes.c_int),
        ("bit_gravity", ctypes.c_int),
        ("win_gravity", ctypes.c_int),
        ("backing_store", ctypes.c_int),
        ("backing_planes", ctypes.c_ulong),
        ("backing_pixel", ctypes.c_ulong),
        ("save_under", ctypes.c_int),
        ("colormap", ctypes.c_ulong),
        ("map_installed", ctypes.c_int),
        ("map_state", ctypes.c_int),
        ("all_event_masks", ctypes.c_long),
        ("your_event_mask", ctypes.c_long),
        ("do_not_propagate_mask", ctypes.c_long),
        ("override_redirect", ctypes.c_int),
        ("screen", ctypes.c_void_p),
    ]


def rejected_timeout_value(value: str) -> str:
    visible = "".join(
        character if character.isprintable() else "\ufffd" for character in value
    )
    if len(visible) <= 128:
        return visible
    return f"{visible[:127]}…"


def dialog_timeout_message(value: str | None) -> str:
    current = (
        "was rejected"
        if value is None
        else f"is {json.dumps(value, ensure_ascii=False)} ms"
    )
    return (
        f"The effective {DIALOG_TIMEOUT_ENV} value {current} "
        f"(source setting; default {DEFAULT_DIALOG_TIMEOUT_MS} ms, "
        f"floor {DIALOG_TIMEOUT_MINIMUM_MS} ms, "
        f"maximum {DIALOG_TIMEOUT_MAXIMUM_MS} ms). "
        f"Set {DIALOG_TIMEOUT_ENV} in the environment that starts REA to a "
        f"positive decimal integer from {DIALOG_TIMEOUT_MINIMUM_MS} to "
        f"{DIALOG_TIMEOUT_MAXIMUM_MS}, then restart REA."
    )


def dialog_timeout_decimal(value: str) -> int | None:
    if re.fullmatch(r"[1-9]\d{0,9}", value) is None:
        return None
    parsed = int(value)
    if parsed > DIALOG_TIMEOUT_MAXIMUM_MS:
        return None
    return parsed


def dialog_timeout_rejection(value: str) -> AdapterFailure:
    shown = rejected_timeout_value(value)
    return AdapterFailure(
        INVALID_DIALOG_TIMEOUT,
        "invalid_dialog_timeout",
        dialog_timeout_message(shown),
        dialog_timeout={
            "setting": DIALOG_TIMEOUT_ENV,
            "value": shown,
            "source": "setting",
            "minimum_ms": DIALOG_TIMEOUT_MINIMUM_MS,
            "maximum_ms": DIALOG_TIMEOUT_MAXIMUM_MS,
            "default_ms": DEFAULT_DIALOG_TIMEOUT_MS,
        },
    )


def positive_timeout(value: str) -> int:
    parsed = dialog_timeout_decimal(value)
    if parsed is None:
        raise argparse.ArgumentTypeError(
            "dialog timeout must be a positive decimal integer from "
            f"{DIALOG_TIMEOUT_MINIMUM_MS} to {DIALOG_TIMEOUT_MAXIMUM_MS}"
        )
    return parsed


def configured_dialog_timeout_ms(requested: int | None) -> int:
    if requested is not None:
        return requested
    configured = os.environ.get(DIALOG_TIMEOUT_ENV)
    if configured is None:
        return DEFAULT_DIALOG_TIMEOUT_MS
    parsed = dialog_timeout_decimal(configured)
    if parsed is None:
        raise dialog_timeout_rejection(configured)
    return parsed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--owner-stdin", action="store_true")
    parser.add_argument("--hopper")
    parser.add_argument("--expected-launcher-sha256")
    parser.add_argument("--socket")
    parser.add_argument(
        "--strategy",
        choices=("direct", "user-mount-namespace"),
        default="direct",
    )
    parser.add_argument("--mount-private-x11", action="store_true")
    parser.add_argument("--xvfb", default="/usr/bin/Xvfb")
    parser.add_argument("--xauth", default="/usr/bin/xauth")
    parser.add_argument("--display-number", type=int)
    parser.add_argument("--dialog-timeout-ms", type=positive_timeout)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    return parser.parse_args()


class OwnerLifetime:
    """The launcher's private pipe is a lifetime capability, independent of PIDs."""

    def __init__(self, enabled: bool) -> None:
        self._poll = select.poll() if enabled else None
        if self._poll is not None:
            # Node/libuv can implement piped stdio with a Unix socket pair.
            mode = os.fstat(0).st_mode
            if not (stat.S_ISFIFO(mode) or stat.S_ISSOCK(mode)):
                raise AdapterFailure(
                    INVALID_LAUNCH_COMMAND,
                    "invalid_launch_command",
                    "owner lifetime requires a private stdin pipe",
                )
            self._poll.register(0, select.POLLIN | select.POLLHUP | select.POLLERR)

    def alive(self) -> bool:
        if self._poll is None:
            return True
        for _, events in self._poll.poll(0):
            if events & (select.POLLHUP | select.POLLERR | select.POLLNVAL):
                return False
            if events & select.POLLIN and not os.read(0, 4096):
                return False
        return True


def wait_for_hopper(child: subprocess.Popen[bytes], owner: OwnerLifetime) -> int:
    while owner.alive():
        try:
            return child.wait(timeout=0.1)
        except subprocess.TimeoutExpired:
            continue
    # run_launch's finally owns cleanup of both direct, unreaped children.
    return 0


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def descendants(pid: int) -> set[int]:
    found = {pid}
    changed = True
    while changed:
        changed = False
        for stat in Path("/proc").glob("[0-9]*/stat"):
            try:
                fields = stat.read_text().split()
                child = int(fields[0])
                parent = int(fields[3])
            except (OSError, ValueError, IndexError):
                continue
            if parent in found and child not in found:
                found.add(child)
                changed = True
    return found


def hopper_is_owned(leader: int, hopper: Path) -> bool:
    expected = hopper.resolve()
    for pid in descendants(leader):
        try:
            if Path(f"/proc/{pid}/exe").resolve() == expected:
                return True
        except OSError:
            continue
    return False


def windows(x11: ctypes.CDLL, display: int, root: int) -> list[tuple[int, int, int, int, int]]:
    found: list[tuple[int, int, int, int, int]] = []
    pending = [root]
    while pending:
        window = pending.pop()
        attributes = XWindowAttributes()
        if x11.XGetWindowAttributes(display, window, ctypes.byref(attributes)):
            if attributes.map_state == 2:
                found.append(
                    (window, attributes.x, attributes.y, attributes.width, attributes.height)
                )
        root_return = ctypes.c_ulong()
        parent_return = ctypes.c_ulong()
        children = ctypes.POINTER(ctypes.c_ulong)()
        count = ctypes.c_uint()
        if x11.XQueryTree(
            display,
            window,
            ctypes.byref(root_return),
            ctypes.byref(parent_return),
            ctypes.byref(children),
            ctypes.byref(count),
        ):
            pending.extend(children[index] for index in range(count.value))
            if children:
                x11.XFree(children)
    return found


def window_title(x11: ctypes.CDLL, display: int, window: int) -> str | None:
    title = ctypes.c_char_p()
    if not x11.XFetchName(display, window, ctypes.byref(title)) or not title.value:
        return None
    try:
        return title.value.decode("utf-8", "replace")
    finally:
        x11.XFree(ctypes.cast(title, ctypes.c_void_p))


def window_transient_for(
    x11: ctypes.CDLL, display: int, window: int
) -> int | None:
    parent = ctypes.c_ulong()
    if not x11.XGetTransientForHint(display, window, ctypes.byref(parent)):
        return None
    return int(parent.value)


def find_demo_dialog(
    x11: ctypes.CDLL,
    display: int,
    observed: list[tuple[int, int, int, int, int]],
) -> tuple[int, int, int, int, int] | None:
    for candidate in observed:
        window = candidate[0]
        if window_title(x11, display, window) not in DIALOG_TITLES:
            continue
        parent = window_transient_for(x11, display, window)
        if parent is None:
            continue
        if window_title(x11, display, parent) == HOPPER_WINDOW_TITLE:
            return candidate
    return None


def demo_click(dialog: tuple[int, int, int, int, int]) -> tuple[int, int]:
    _window, x, y, _width, height = dialog
    return x + DEMO_CLICK_LEFT, y + height - DEMO_CLICK_BOTTOM


def watch_for_demo_dialog(
    x11: ctypes.CDLL,
    display: int,
    timeout_ms: int,
    *,
    owner_alive: Callable[[], bool],
    socket_ready: Callable[[], bool],
    process_owned: Callable[[], bool],
    process_exited: Callable[[], bool],
    monotonic: Callable[[], float],
    sleep: Callable[[float], None],
    list_windows: Callable[[], list[tuple[int, int, int, int, int]]],
) -> tuple[int, int, int, int, int]:
    deadline = monotonic() + timeout_ms / 1000
    hopper_window_observed = False
    while monotonic() < deadline:
        if not owner_alive():
            raise DemoWatchStop("owner_closed")
        if socket_ready():
            raise DemoWatchStop("socket_ready")
        if not process_owned():
            if not process_exited():
                sleep(0.1)
                continue
            raise AdapterFailure(
                HOPPER_EXITED_DURING_STARTUP,
                "hopper_exited_during_startup",
                "owned Hopper process exited",
            )
        observed = list_windows()
        hopper_window_observed = hopper_window_observed or any(
            window_title(x11, display, candidate[0]) == HOPPER_WINDOW_TITLE
            for candidate in observed
        )
        dialog = find_demo_dialog(x11, display, observed)
        if dialog is not None:
            return dialog
        sleep(0.1)
    raise classify_watch_timeout(process_owned(), hopper_window_observed)


def classify_watch_timeout(
    owned: bool,
    hopper_window_observed: bool,
) -> AdapterFailure:
    if not owned:
        return AdapterFailure(
            PROCESS_OWNERSHIP_MISMATCH,
            "process_ownership_mismatch",
            "Hopper process ownership mismatch",
        )
    if hopper_window_observed:
        return AdapterFailure(
            UNSUPPORTED_DEMO_DIALOG,
            "unsupported_demo_dialog",
            "Hopper did not present a supported registration dialog",
        )
    return AdapterFailure(
        DEMO_DIALOG_ABSENT,
        "demo_dialog_absent",
        "Hopper started without presenting a registration dialog",
    )


def configure_x11(x11: ctypes.CDLL, xtst: ctypes.CDLL) -> None:
    window_pointer = ctypes.POINTER(ctypes.c_ulong)
    x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x11.XOpenDisplay.restype = ctypes.c_void_p
    x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
    x11.XDefaultRootWindow.restype = ctypes.c_ulong
    x11.XDisplayWidth.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XDisplayWidth.restype = ctypes.c_int
    x11.XDisplayHeight.argtypes = [ctypes.c_void_p, ctypes.c_int]
    x11.XDisplayHeight.restype = ctypes.c_int
    x11.XGetWindowAttributes.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.POINTER(XWindowAttributes),
    ]
    x11.XGetWindowAttributes.restype = ctypes.c_int
    x11.XFetchName.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.POINTER(ctypes.c_char_p),
    ]
    x11.XFetchName.restype = ctypes.c_int
    x11.XGetTransientForHint.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.POINTER(ctypes.c_ulong),
    ]
    x11.XGetTransientForHint.restype = ctypes.c_int
    x11.XQueryTree.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        window_pointer,
        window_pointer,
        ctypes.POINTER(window_pointer),
        ctypes.POINTER(ctypes.c_uint),
    ]
    x11.XQueryTree.restype = ctypes.c_int
    x11.XFree.argtypes = [ctypes.c_void_p]
    x11.XFree.restype = ctypes.c_int
    x11.XFlush.argtypes = [ctypes.c_void_p]
    x11.XFlush.restype = ctypes.c_int
    x11.XCloseDisplay.argtypes = [ctypes.c_void_p]
    x11.XCloseDisplay.restype = ctypes.c_int
    xtst.XTestFakeMotionEvent.argtypes = [
        ctypes.c_void_p,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_ulong,
    ]
    xtst.XTestFakeMotionEvent.restype = ctypes.c_int
    xtst.XTestFakeButtonEvent.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint,
        ctypes.c_int,
        ctypes.c_ulong,
    ]
    xtst.XTestFakeButtonEvent.restype = ctypes.c_int


def is_wsl() -> bool:
    for path in (Path("/proc/sys/kernel/osrelease"), Path("/proc/version")):
        try:
            if "microsoft" in path.read_text().lower():
                return True
        except OSError:
            continue
    return False


def socket_directory_state() -> tuple[str | None, bool | None, bool]:
    try:
        value = X11_SOCKET_DIRECTORY.lstat()
    except FileNotFoundError:
        try:
            read_only = bool(os.statvfs(X11_SOCKET_DIRECTORY.parent).f_flag & os.ST_RDONLY)
        except OSError:
            read_only = None
        return None, read_only, False
    except OSError:
        return None, None, False
    try:
        read_only = bool(os.statvfs(X11_SOCKET_DIRECTORY).f_flag & os.ST_RDONLY)
    except OSError:
        read_only = None
    return f"{stat.S_IMODE(value.st_mode):04o}", read_only, stat.S_ISDIR(value.st_mode)


def diagnostic(
    args: argparse.Namespace,
    operation: str,
    status: str,
    failure: AdapterFailure | None = None,
    capture: CapturedStderr | None = None,
) -> dict[str, object]:
    mode, read_only, _ = socket_directory_state()
    captured_bytes, _ = (0, "") if capture is None else capture.snapshot()
    record = {
        "component": "hopper_private_display",
        "operation": operation,
        "status": status,
        "failure_code": None if failure is None else failure_name(failure.code),
        "reason": "ready" if failure is None else failure.reason,
        "socket_directory": str(X11_SOCKET_DIRECTORY),
        "socket_directory_mode": mode,
        "mount_read_only": read_only,
        "effective_socket_directory_mode": mode,
        "effective_mount_read_only": read_only,
        "wsl": is_wsl(),
        "strategy": args.strategy,
        "fallback_reason": None,
        "xvfb_stderr_bytes": captured_bytes
        if failure is None
        else failure.stderr_bytes,
    }
    if failure is not None and failure.dialog_timeout is not None:
        record["dialog_timeout"] = failure.dialog_timeout
    return record


def failure_name(code: int) -> str:
    return {
        PRIVATE_DISPLAY_UNAVAILABLE: "private_display_unavailable",
        X11_AUTHORIZATION_FAILED: "x11_authorization_failed",
        UNSUPPORTED_HOPPER_BUILD: "unsupported_hopper_build",
        INVALID_LAUNCH_COMMAND: "invalid_launch_command",
        PROCESS_OWNERSHIP_MISMATCH: "process_ownership_mismatch",
        HOPPER_EXITED_DURING_STARTUP: "hopper_exited_during_startup",
        UNSUPPORTED_DEMO_DIALOG: "unsupported_demo_dialog",
        UNEXPECTED_DISPLAY_GEOMETRY: "unexpected_display_geometry",
        X11_INPUT_FAILED: "x11_input_failed",
        RUNTIME_DEPENDENCY_UNAVAILABLE: "runtime_dependency_unavailable",
        X11_SOCKET_DIRECTORY_UNUSABLE: "x11_socket_directory_unusable",
        DEMO_DIALOG_ABSENT: "demo_dialog_absent",
        INVALID_DIALOG_TIMEOUT: "invalid_dialog_timeout",
    }[code]


def emit_diagnostic(value: dict[str, object]) -> None:
    print(
        DIAGNOSTIC_PREFIX + json.dumps(value, sort_keys=True, separators=(",", ":")),
        file=os.sys.stderr,
    )


def mount_private_x11() -> None:
    try:
        mounted = subprocess.run(
            [
                "/usr/bin/mount",
                "-t",
                "tmpfs",
                "-o",
                "mode=1777,nosuid,nodev",
                "rea-x11",
                str(X11_SOCKET_DIRECTORY),
            ],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=2,
        )
    except FileNotFoundError as error:
        raise AdapterFailure(
            RUNTIME_DEPENDENCY_UNAVAILABLE,
            "missing_mount",
            "mount executable unavailable",
        ) from error
    except subprocess.TimeoutExpired as error:
        raise AdapterFailure(
            X11_SOCKET_DIRECTORY_UNUSABLE,
            "mount_failed",
            "private X11 mount timed out",
        ) from error
    if mounted.returncode != 0:
        raise AdapterFailure(
            X11_SOCKET_DIRECTORY_UNUSABLE,
            "mount_failed",
            "private X11 mount failed",
        )
    mode, read_only, directory = socket_directory_state()
    if not directory or mode != "1777" or read_only is not False:
        raise AdapterFailure(
            X11_SOCKET_DIRECTORY_UNUSABLE,
            "mount_validation_failed",
            "private X11 mount validation failed",
        )


def stop_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=2)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def authorize_display(
    authority: Path,
    display_name: str,
    xauth_path: str,
) -> None:
    try:
        authorized = subprocess.run(
            [
                xauth_path,
                "-q",
                "-f",
                str(authority),
                "source",
                "-",
            ],
            input=("add %s . %s\n" % (display_name, secrets.token_hex(16))).encode("ascii"),
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=2,
        )
    except FileNotFoundError as error:
        raise AdapterFailure(
            RUNTIME_DEPENDENCY_UNAVAILABLE,
            "missing_xauth",
            "xauth executable unavailable",
        ) from error
    except subprocess.TimeoutExpired as error:
        raise AdapterFailure(
            X11_AUTHORIZATION_FAILED,
            "xauth_failed",
            "private X authorization timed out",
        ) from error
    if authorized.returncode != 0:
        raise AdapterFailure(
            X11_AUTHORIZATION_FAILED,
            "xauth_failed",
            "private X authorization failed",
        )
    try:
        authority.chmod(0o600)
    except OSError as error:
        raise AdapterFailure(
            X11_AUTHORIZATION_FAILED,
            "xauth_failed",
            "private X authorization file unavailable",
        ) from error


def classify_xvfb_failure(capture: CapturedStderr) -> AdapterFailure:
    stderr_bytes, text = capture.snapshot()
    mode, read_only, directory = socket_directory_state()
    if read_only is True:
        return AdapterFailure(
            X11_SOCKET_DIRECTORY_UNUSABLE,
            "socket_directory_read_only",
            "X11 socket directory is read-only",
            stderr_bytes,
        )
    if directory and mode != "1777":
        return AdapterFailure(
            X11_SOCKET_DIRECTORY_UNUSABLE,
            "socket_directory_mode",
            "X11 socket directory mode is not 1777",
            stderr_bytes,
        )
    if mode is not None and not directory:
        return AdapterFailure(
            X11_SOCKET_DIRECTORY_UNUSABLE,
            "socket_directory_type",
            "X11 socket path is not a directory",
            stderr_bytes,
        )
    lowered = text.lower()
    if "error while loading shared libraries" in lowered:
        return AdapterFailure(
            RUNTIME_DEPENDENCY_UNAVAILABLE,
            "missing_library",
            "Xvfb shared library unavailable",
            stderr_bytes,
        )
    if any(
        marker in lowered
        for marker in (
            "server is already active for display",
            "address already in use",
            "cannot establish any listening sockets",
        )
    ):
        return AdapterFailure(
            PRIVATE_DISPLAY_UNAVAILABLE,
            "address_collision",
            "private display address collision",
            stderr_bytes,
        )
    return AdapterFailure(
        PRIVATE_DISPLAY_UNAVAILABLE,
        "xvfb_startup_failed",
        "private X display unavailable",
        stderr_bytes,
    )


def start_xvfb(
    session: Path,
    args: argparse.Namespace,
) -> tuple[subprocess.Popen[bytes], str, Path, CapturedStderr]:
    authority = session / "Xauthority"
    collision: AdapterFailure | None = None
    for _ in range(3):
        display_number = (
            args.display_number
            if args.display_number is not None
            else 100 + secrets.randbelow(900)
        )
        display_name = f":{display_number}"
        if Path(f"/tmp/.X11-unix/X{display_number}").exists() or Path(
            f"/tmp/.X{display_number}-lock"
        ).exists():
            collision = AdapterFailure(
                PRIVATE_DISPLAY_UNAVAILABLE,
                "address_collision",
                "private display address collision",
            )
            if args.display_number is not None:
                raise collision
            continue
        authorize_display(authority, display_name, args.xauth)
        try:
            process = subprocess.Popen(
                [
                    args.xvfb,
                    display_name,
                    "-screen",
                    "0",
                    "1280x1024x24",
                    "-nolisten",
                    "tcp",
                    "-auth",
                    str(authority),
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
        except FileNotFoundError as error:
            raise AdapterFailure(
                RUNTIME_DEPENDENCY_UNAVAILABLE,
                "missing_xvfb",
                "Xvfb executable unavailable",
            ) from error
        if process.stderr is None:
            stop_process(process)
            raise AdapterFailure(
                PRIVATE_DISPLAY_UNAVAILABLE,
                "xvfb_startup_failed",
                "Xvfb stderr unavailable",
            )
        capture = CapturedStderr(process.stderr)
        deadline = time.monotonic() + 2
        socket = Path(f"/tmp/.X11-unix/X{display_number}")
        while time.monotonic() < deadline and process.poll() is None:
            if socket.is_socket():
                return process, display_name, authority, capture
            time.sleep(0.05)
        stop_process(process)
        capture.close()
        failure = classify_xvfb_failure(capture)
        if failure.reason != "address_collision" or args.display_number is not None:
            raise failure
        collision = failure
    raise collision or AdapterFailure(
        PRIVATE_DISPLAY_UNAVAILABLE,
        "address_collision",
        "private display address collision",
    )


def run_probe(args: argparse.Namespace) -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="rea-x11-probe-", dir="/tmp") as root:
        xvfb, _, _, capture = start_xvfb(Path(root), args)
        try:
            stop_process(xvfb)
            capture.close()
            return diagnostic(args, "probe", "ready", capture=capture)
        finally:
            stop_process(xvfb)
            capture.close()


def run_launch(args: argparse.Namespace) -> int:
    if (
        args.hopper is None or args.socket is None
        or args.expected_launcher_sha256 is None
        or re.fullmatch(r"[a-f0-9]{64}", args.expected_launcher_sha256) is None
    ):
        raise AdapterFailure(
            INVALID_LAUNCH_COMMAND,
            "invalid_launch_command",
            "missing Hopper launch coordinates",
        )
    owner = OwnerLifetime(args.owner_stdin)
    if not owner.alive():
        return 0
    hopper = Path(args.hopper)
    socket = Path(args.socket)
    try:
        # The parent owns publisher/package interpretation. Recheck its admitted
        # launcher bytes immediately before execution, preserving all X11 guards.
        supported = digest(hopper) == args.expected_launcher_sha256
    except OSError as error:
        raise AdapterFailure(
            INVALID_LAUNCH_COMMAND,
            "invalid_launch_command",
            "Hopper binary unavailable",
        ) from error
    if not supported:
        raise AdapterFailure(
            UNSUPPORTED_HOPPER_BUILD,
            "unsupported_hopper_build",
            "Hopper binary differs from the authenticated release",
        )
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command or Path(command[0]).resolve() != hopper.resolve():
        raise AdapterFailure(
            INVALID_LAUNCH_COMMAND,
            "invalid_launch_command",
            "invalid Hopper launch command",
        )
    timeout_ms = configured_dialog_timeout_ms(
        getattr(args, "dialog_timeout_ms", None)
    )
    xvfb, display_name, authority, capture = start_xvfb(socket.parent, args)
    child: subprocess.Popen[bytes] | None = None
    display: int | None = None
    try:
        if not owner.alive():
            return 0
        hopper_environment = dict(os.environ)
        for name in ("WAYLAND_DISPLAY", "WAYLAND_SOCKET"):
            hopper_environment.pop(name, None)
        hopper_environment.update(
            {
                "DISPLAY": display_name,
                "XAUTHORITY": str(authority),
                "GDK_BACKEND": "x11",
                "QT_QPA_PLATFORM": "xcb",
                "XDG_SESSION_TYPE": "x11",
            }
        )
        # Children must not consume or retain REA's lifetime pipe.
        child = subprocess.Popen(
            command, env=hopper_environment, stdin=subprocess.DEVNULL
        )
        leader = os.getpid()
        os.environ["XAUTHORITY"] = str(authority)

        try:
            x11 = ctypes.CDLL("libX11.so.6")
            xtst = ctypes.CDLL("libXtst.so.6")
        except OSError as error:
            raise AdapterFailure(
                RUNTIME_DEPENDENCY_UNAVAILABLE,
                "missing_library",
                "X11 runtime unavailable",
            ) from error
        configure_x11(x11, xtst)
        display = x11.XOpenDisplay(display_name.encode())
        if not display:
            raise AdapterFailure(
                PRIVATE_DISPLAY_UNAVAILABLE,
                "x11_connection_failed",
                "private X display unavailable",
            )
        root = x11.XDefaultRootWindow(display)
        if (
            x11.XDisplayWidth(display, 0),
            x11.XDisplayHeight(display, 0),
        ) != EXPECTED_SCREEN:
            raise AdapterFailure(
                UNEXPECTED_DISPLAY_GEOMETRY,
                "unexpected_display_geometry",
                "unexpected private display geometry",
            )

        try:
            dialog = watch_for_demo_dialog(
                x11,
                display,
                timeout_ms,
                owner_alive=owner.alive,
                socket_ready=socket.exists,
                process_owned=lambda: hopper_is_owned(leader, hopper),
                process_exited=lambda: child is not None and child.poll() is not None,
                monotonic=time.monotonic,
                sleep=time.sleep,
                list_windows=lambda: windows(x11, display, root),
            )
        except DemoWatchStop as stopped:
            if stopped.reason == "owner_closed":
                return 0
            x11.XCloseDisplay(display)
            display = None
            return wait_for_hopper(child, owner)

        click_x, click_y = demo_click(dialog)
        input_results = (
            xtst.XTestFakeMotionEvent(display, -1, click_x, click_y, 0),
            xtst.XTestFakeButtonEvent(display, 1, True, 0),
            xtst.XTestFakeButtonEvent(display, 1, False, 0),
        )
        if not all(input_results):
            raise AdapterFailure(
                X11_INPUT_FAILED,
                "x11_input_failed",
                "private X input failed",
            )
        x11.XFlush(display)
        x11.XCloseDisplay(display)
        display = None
        return wait_for_hopper(child, owner)
    except AdapterFailure as error:
        raise error.with_stderr(capture)
    finally:
        if display is not None:
            x11.XCloseDisplay(display)
        if child is not None:
            stop_process(child)
        stop_process(xvfb)
        capture.close()


def main() -> int:
    args = parse_args()
    try:
        if args.mount_private_x11:
            mount_private_x11()
        if args.probe:
            emit_diagnostic(run_probe(args))
            return 0
        return run_launch(args)
    except AdapterFailure as error:
        emit_diagnostic(diagnostic(args, "probe" if args.probe else "launch", "error", error))
        return error.code
    except Exception:
        failure = AdapterFailure(
            PRIVATE_DISPLAY_UNAVAILABLE,
            "unexpected_failure",
            "private display adapter failed",
        )
        emit_diagnostic(diagnostic(args, "probe" if args.probe else "launch", "error", failure))
        return failure.code


if __name__ == "__main__":
    raise SystemExit(main())
