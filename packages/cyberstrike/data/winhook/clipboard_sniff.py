#!/usr/bin/env python3
"""
clipboard_sniff.py - Monitor Windows clipboard contents for changes.

Polls the clipboard at a configurable interval using user32.dll and
kernel32.dll via ctypes. Only emits output when the clipboard content
changes (compared by hash). Captures the foreground window title and
PID at the time of each change.

Requires: Administrator privileges on Windows.

Part of CyberStrike offensive security platform.
"""

import argparse
import ctypes
import ctypes.wintypes
import hashlib
import json
import os
import signal
import sys
import time
from datetime import datetime


# --- Windows clipboard constants ---

CF_UNICODETEXT = 13


class ClipboardSniffer:
    """Monitors the Windows clipboard for content changes."""

    def __init__(self, duration=None, interval=2, json_output=False):
        self.duration = duration
        self.interval = interval
        self.json_output = json_output
        self.running = True
        self.start_time = None
        self.event_count = 0
        self.last_content_hash = None
        self.user32 = None
        self.kernel32 = None

    def check_admin(self):
        """Verify the script is running with Administrator privileges."""
        try:
            is_admin = ctypes.windll.shell32.IsUserAnAdmin()
        except AttributeError:
            is_admin = False
        if not is_admin:
            print(
                "ERROR: clipboard_sniff.py requires Administrator privileges.",
                file=sys.stderr,
            )
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  clipboard_sniff.py - Clipboard Monitor (Windows)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Interval:    {self.interval}s")
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
        """Load user32.dll and kernel32.dll with proper type annotations."""
        self.user32 = ctypes.windll.user32
        self.kernel32 = ctypes.windll.kernel32

        # OpenClipboard
        self.user32.OpenClipboard.argtypes = [ctypes.wintypes.HWND]
        self.user32.OpenClipboard.restype = ctypes.wintypes.BOOL

        # CloseClipboard
        self.user32.CloseClipboard.argtypes = []
        self.user32.CloseClipboard.restype = ctypes.wintypes.BOOL

        # GetClipboardData
        self.user32.GetClipboardData.argtypes = [ctypes.wintypes.UINT]
        self.user32.GetClipboardData.restype = ctypes.wintypes.HANDLE

        # GetForegroundWindow
        self.user32.GetForegroundWindow.argtypes = []
        self.user32.GetForegroundWindow.restype = ctypes.wintypes.HWND

        # GetWindowTextW
        self.user32.GetWindowTextW.argtypes = [
            ctypes.wintypes.HWND,
            ctypes.wintypes.LPWSTR,
            ctypes.c_int,
        ]
        self.user32.GetWindowTextW.restype = ctypes.c_int

        # GetWindowThreadProcessId
        self.user32.GetWindowThreadProcessId.argtypes = [
            ctypes.wintypes.HWND,
            ctypes.POINTER(ctypes.wintypes.DWORD),
        ]
        self.user32.GetWindowThreadProcessId.restype = ctypes.wintypes.DWORD

        # GlobalLock / GlobalUnlock / GlobalSize
        self.kernel32.GlobalLock.argtypes = [ctypes.wintypes.HGLOBAL]
        self.kernel32.GlobalLock.restype = ctypes.c_void_p

        self.kernel32.GlobalUnlock.argtypes = [ctypes.wintypes.HGLOBAL]
        self.kernel32.GlobalUnlock.restype = ctypes.wintypes.BOOL

        self.kernel32.GlobalSize.argtypes = [ctypes.wintypes.HGLOBAL]
        self.kernel32.GlobalSize.restype = ctypes.c_size_t

    def _log(self, message, level="info", **extra):
        if self.json_output:
            payload = {"level": level, "message": message, "timestamp": time.time()}
            payload.update(extra)
            print(json.dumps(payload), flush=True)
        else:
            print(f"[clipboard_sniff] {message}", flush=True)

    def _get_foreground_info(self):
        """Return the active window title and its process PID."""
        hwnd = self.user32.GetForegroundWindow()
        if not hwnd:
            return "", 0

        title_buf = ctypes.create_unicode_buffer(512)
        self.user32.GetWindowTextW(hwnd, title_buf, 512)
        title = title_buf.value

        pid = ctypes.wintypes.DWORD(0)
        self.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))

        return title, pid.value

    def _read_clipboard(self):
        """Read the current clipboard text content. Returns None on failure."""
        if not self.user32.OpenClipboard(None):
            return None

        try:
            handle = self.user32.GetClipboardData(CF_UNICODETEXT)
            if not handle:
                return None

            locked_ptr = self.kernel32.GlobalLock(handle)
            if not locked_ptr:
                return None

            try:
                content = ctypes.wstring_at(locked_ptr)
                return content
            finally:
                self.kernel32.GlobalUnlock(handle)
        finally:
            self.user32.CloseClipboard()

    def _content_hash(self, content):
        """Compute a SHA-256 hash of clipboard content for change detection."""
        if content is None:
            return None
        return hashlib.sha256(content.encode("utf-8", errors="replace")).hexdigest()

    def _emit_change(self, content, window_title, pid):
        """Output a clipboard change event."""
        self.event_count += 1
        timestamp = datetime.now().isoformat()
        content_length = len(content) if content else 0
        preview = (content[:200] if content else "")

        if self.json_output:
            record = {
                "level": "clipboard_change",
                "timestamp": timestamp,
                "content_preview": preview,
                "content_length": content_length,
                "pid_of_foreground_window": pid,
                "window_title": window_title,
                "count": self.event_count,
            }
            print(json.dumps(record), flush=True)
        else:
            # Escape newlines/tabs in preview for single-line display
            safe_preview = preview.replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
            print(
                f"[{timestamp}] "
                f"LEN={content_length:<8} "
                f"PID={pid:<8} "
                f"WIN={window_title[:40]:<40} "
                f"CONTENT={safe_preview}",
                flush=True,
            )

    def run(self):
        """Poll clipboard at interval, emit on content change."""
        self.check_admin()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self._load_libraries()
        self.start_time = time.monotonic()

        duration_msg = f" for {self.duration} seconds" if self.duration else ""
        self._log(
            f"Clipboard monitoring active{duration_msg}. "
            f"Polling every {self.interval}s.",
            level="info",
            status="active",
            interval=self.interval,
            duration=self.duration,
        )
        if not self.duration:
            self._log("Press Ctrl+C to stop.")

        if not self.json_output:
            print(
                f"{'TIMESTAMP':<28} {'LEN':<12} "
                f"{'PID':<12} {'WINDOW':<44} {'CONTENT'}"
            )
            print("-" * 140)

        # Capture initial clipboard state without emitting
        initial_content = self._read_clipboard()
        self.last_content_hash = self._content_hash(initial_content)

        while self.running:
            time.sleep(self.interval)

            if not self.running:
                break

            content = self._read_clipboard()
            current_hash = self._content_hash(content)

            if current_hash != self.last_content_hash:
                window_title, pid = self._get_foreground_info()
                self._emit_change(content, window_title, pid)
                self.last_content_hash = current_hash

            if self.duration is not None:
                elapsed = time.monotonic() - self.start_time
                if elapsed >= self.duration:
                    self._log(
                        f"Duration of {self.duration}s reached. Stopping monitor.",
                        level="info",
                    )
                    break

        self.cleanup()

    def cleanup(self):
        """Print summary and exit."""
        elapsed = 0.0
        if self.start_time:
            elapsed = time.monotonic() - self.start_time

        print(f"\n--- clipboard_sniff summary ---")
        print(f"Detected {self.event_count} clipboard change(s)")
        print(f"Duration: {elapsed:.1f}s")
        print("Cleanup complete. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor Windows clipboard for content changes. Polls at a "
        "configurable interval and only outputs when content changes.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 clipboard_sniff.py\n"
            "  python3 clipboard_sniff.py --duration 120 --interval 1\n"
            "  python3 clipboard_sniff.py --json-output --interval 5\n"
        ),
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=None,
        metavar="SECONDS",
        help="Monitor duration in seconds. If not specified, runs until Ctrl+C.",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=2,
        metavar="SECONDS",
        help="Polling interval in seconds. Default: 2.",
    )
    parser.add_argument(
        "--json-output",
        action="store_true",
        default=False,
        help="Output clipboard changes as JSON lines for structured consumption.",
    )
    args = parser.parse_args()

    if args.duration is not None and args.duration <= 0:
        print("Error: Duration must be a positive integer.", file=sys.stderr)
        sys.exit(1)

    if args.interval <= 0:
        print("Error: Interval must be a positive number.", file=sys.stderr)
        sys.exit(1)

    sniffer = ClipboardSniffer(
        duration=args.duration,
        interval=args.interval,
        json_output=args.json_output,
    )
    sniffer.run()


if __name__ == "__main__":
    main()
