#!/usr/bin/env python3
"""
cleanup_mac.py — Remove CyberStrike artifacts and restore macOS target state.

Finds and removes LaunchAgents/LaunchDaemons matching CyberStrike patterns,
kills running machook/dtrace processes, removes temporary files, and clears
machook-specific shell history entries.

Requires: root privileges for full cleanup.

Part of CyberStrike offensive security platform.
"""

import argparse
import glob
import json
import os
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path


CS_PATTERNS = [
    "cyberstrike",
    "cs_",
    "machook",
    "CyberStrike",
]

PROCESS_PATTERNS = [
    "machook",
    "cyberstrike",
    "dtrace_exec",
    "dtrace_net",
    "dtrace_file",
    "keylog_mac",
    "keychain_dump",
    "chrome_creds",
    "ssh_keys",
    "tcc_bypass",
    "xprotect_check",
    "gatekeeper_bypass",
    "log_clear",
    "cleanup_mac",
]


class MacCleaner:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.actions_taken = 0
        self.actions_failed = 0

    def check_root(self):
        if os.geteuid() != 0:
            print(
                "WARNING: Running without root — some artifacts cannot be removed.",
                file=sys.stderr,
            )

    def print_banner(self):
        print("=" * 60)
        print("CyberStrike — macOS Cleanup")
        print("=" * 60)
        print(f"PID:     {os.getpid()}")
        print(f"Dry-run: {self.args.dry_run}")
        print(f"Output:  {'JSON' if self.args.json_output else 'text'}")
        print(f"Started: {datetime.now().isoformat()}")
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
            category = record.get("category", "N/A")
            detail = record.get("detail", "")
            print(f"[{status:<10}] {category:<20} {detail}", flush=True)

    def cleanup_launch_agents(self):
        """Find and unload/remove LaunchAgents and LaunchDaemons matching CS patterns."""
        if not self.running:
            return

        launch_dirs = [
            Path.home() / "Library/LaunchAgents",
            Path("/Library/LaunchAgents"),
            Path("/Library/LaunchDaemons"),
            Path("/System/Library/LaunchDaemons"),
        ]

        for launch_dir in launch_dirs:
            if not self.running:
                break
            if not launch_dir.exists():
                continue

            for plist_file in launch_dir.glob("*.plist"):
                if not self.running:
                    break
                filename = plist_file.name.lower()
                matched = any(pat.lower() in filename for pat in CS_PATTERNS)

                if not matched:
                    try:
                        content = plist_file.read_text(errors="replace").lower()
                        matched = any(pat.lower() in content for pat in CS_PATTERNS)
                    except (PermissionError, OSError):
                        continue

                if not matched:
                    continue

                if self.args.dry_run:
                    self.emit(
                        {
                            "timestamp": datetime.now().isoformat(),
                            "category": "launch_agent",
                            "action": "would_remove",
                            "status": "dry_run",
                            "detail": str(plist_file),
                        }
                    )
                    continue

                try:
                    subprocess.run(
                        ["launchctl", "unload", str(plist_file)],
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                except Exception:
                    pass

                try:
                    plist_file.unlink()
                    self.actions_taken += 1
                    self.emit(
                        {
                            "timestamp": datetime.now().isoformat(),
                            "category": "launch_agent",
                            "action": "removed",
                            "status": "cleaned",
                            "detail": str(plist_file),
                        }
                    )
                except (PermissionError, OSError) as e:
                    self.actions_failed += 1
                    self.emit(
                        {
                            "timestamp": datetime.now().isoformat(),
                            "category": "launch_agent",
                            "action": "remove_failed",
                            "status": "failed",
                            "detail": str(plist_file),
                            "error": str(e),
                        }
                    )

    def kill_processes(self):
        """Kill running machook/dtrace/CyberStrike processes."""
        if not self.running:
            return

        my_pid = os.getpid()
        killed = []

        try:
            result = subprocess.run(
                ["ps", "aux"], capture_output=True, text=True, timeout=10
            )
            if result.returncode != 0:
                return

            for line in result.stdout.splitlines()[1:]:
                if not self.running:
                    break
                parts = line.split(None, 10)
                if len(parts) < 11:
                    continue
                try:
                    pid = int(parts[1])
                except ValueError:
                    continue

                if pid == my_pid:
                    continue

                cmd = parts[10].lower()
                matched_pattern = None
                for pattern in PROCESS_PATTERNS:
                    if pattern.lower() in cmd:
                        matched_pattern = pattern
                        break

                if not matched_pattern:
                    continue

                if self.args.dry_run:
                    self.emit(
                        {
                            "timestamp": datetime.now().isoformat(),
                            "category": "process",
                            "action": "would_kill",
                            "status": "dry_run",
                            "detail": f"PID {pid}: {parts[10][:80]}",
                            "pid": pid,
                            "pattern": matched_pattern,
                        }
                    )
                    continue

                try:
                    os.kill(pid, signal.SIGTERM)
                    time.sleep(0.5)
                    try:
                        os.kill(pid, 0)
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass

                    killed.append(pid)
                    self.actions_taken += 1
                    self.emit(
                        {
                            "timestamp": datetime.now().isoformat(),
                            "category": "process",
                            "action": "killed",
                            "status": "cleaned",
                            "detail": f"PID {pid}: {parts[10][:80]}",
                            "pid": pid,
                            "pattern": matched_pattern,
                        }
                    )
                except (ProcessLookupError, PermissionError) as e:
                    self.actions_failed += 1
                    self.emit(
                        {
                            "timestamp": datetime.now().isoformat(),
                            "category": "process",
                            "action": "kill_failed",
                            "status": "failed",
                            "detail": f"PID {pid}",
                            "pid": pid,
                            "error": str(e),
                        }
                    )
        except Exception:
            pass

    def cleanup_temp_files(self):
        """Remove CyberStrike temporary files."""
        if not self.running:
            return

        temp_patterns = [
            "/tmp/cs_*",
            "/tmp/cyberstrike_*",
            "/tmp/machook_*",
            "/tmp/.cs_*",
        ]

        files_removed = 0
        bytes_freed = 0

        for pattern in temp_patterns:
            if not self.running:
                break
            for match in glob.glob(pattern):
                if not self.running:
                    break
                p = Path(match)
                if not p.exists():
                    continue

                if self.args.dry_run:
                    self.emit(
                        {
                            "timestamp": datetime.now().isoformat(),
                            "category": "temp_file",
                            "action": "would_remove",
                            "status": "dry_run",
                            "detail": match,
                        }
                    )
                    continue

                try:
                    if p.is_file():
                        size = p.stat().st_size
                        p.unlink()
                        bytes_freed += size
                        files_removed += 1
                    elif p.is_dir():
                        import shutil

                        size = sum(
                            f.stat().st_size
                            for f in p.rglob("*")
                            if f.is_file()
                        )
                        shutil.rmtree(match)
                        bytes_freed += size
                        files_removed += 1
                except (PermissionError, OSError):
                    self.actions_failed += 1

        if files_removed > 0:
            self.actions_taken += files_removed
            self.emit(
                {
                    "timestamp": datetime.now().isoformat(),
                    "category": "temp_files",
                    "action": "removed",
                    "status": "cleaned",
                    "detail": f"{files_removed} temp files/dirs removed",
                    "files_count": files_removed,
                    "bytes_freed": bytes_freed,
                }
            )

    def cleanup_copied_dbs(self):
        """Remove any copied database files (Chrome Login Data copies, etc)."""
        if not self.running:
            return

        db_patterns = [
            "/tmp/*.db",
            "/tmp/tmp*.db",
        ]

        for pattern in db_patterns:
            for match in glob.glob(pattern):
                if not self.running:
                    break
                p = Path(match)
                try:
                    content_preview = ""
                    with open(match, "rb") as f:
                        header = f.read(64)
                    if b"SQLite" in header:
                        import sqlite3

                        try:
                            conn = sqlite3.connect(match)
                            cursor = conn.cursor()
                            cursor.execute(
                                "SELECT name FROM sqlite_master WHERE type='table'"
                            )
                            tables = [row[0] for row in cursor.fetchall()]
                            conn.close()
                            if "logins" in tables or "moz_logins" in tables:
                                if self.args.dry_run:
                                    self.emit(
                                        {
                                            "timestamp": datetime.now().isoformat(),
                                            "category": "copied_db",
                                            "action": "would_remove",
                                            "status": "dry_run",
                                            "detail": match,
                                            "tables": tables,
                                        }
                                    )
                                else:
                                    p.unlink()
                                    self.actions_taken += 1
                                    self.emit(
                                        {
                                            "timestamp": datetime.now().isoformat(),
                                            "category": "copied_db",
                                            "action": "removed",
                                            "status": "cleaned",
                                            "detail": match,
                                        }
                                    )
                        except Exception:
                            pass
                except Exception:
                    pass

    def check_remaining_artifacts(self):
        """Report any remaining CyberStrike artifacts."""
        if not self.running:
            return

        try:
            result = subprocess.run(
                ["ps", "aux"], capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                remaining = []
                for line in result.stdout.splitlines()[1:]:
                    cmd = line.split(None, 10)[-1].lower() if len(line.split(None, 10)) > 10 else ""
                    if any(p.lower() in cmd for p in PROCESS_PATTERNS):
                        parts = line.split(None, 10)
                        try:
                            pid = int(parts[1])
                            if pid != os.getpid():
                                remaining.append(
                                    {"pid": pid, "cmd": parts[10][:100]}
                                )
                        except (ValueError, IndexError):
                            pass

                if remaining:
                    self.emit(
                        {
                            "timestamp": datetime.now().isoformat(),
                            "category": "remaining",
                            "action": "check",
                            "status": "warning",
                            "detail": f"{len(remaining)} CS processes still running",
                            "processes": remaining,
                        }
                    )
                else:
                    self.emit(
                        {
                            "timestamp": datetime.now().isoformat(),
                            "category": "remaining",
                            "action": "check",
                            "status": "clean",
                            "detail": "No remaining CyberStrike processes found",
                        }
                    )
        except Exception:
            pass

    def run(self):
        self.check_root()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        operations = [
            ("LaunchAgents/Daemons", self.cleanup_launch_agents),
            ("Processes", self.kill_processes),
            ("Temp files", self.cleanup_temp_files),
            ("Copied databases", self.cleanup_copied_dbs),
            ("Remaining artifacts", self.check_remaining_artifacts),
        ]

        for name, op in operations:
            if not self.running:
                break
            if not self.args.json_output:
                print(f"\n[*] Checking {name}...", flush=True)
            op()

        self.cleanup_summary()

    def cleanup_summary(self):
        print(f"\n--- cleanup_mac summary ---")
        print(f"Items checked: {self.event_count}")
        print(f"Actions taken: {self.actions_taken}")
        print(f"Actions failed: {self.actions_failed}")
        if self.args.dry_run:
            print("Mode: DRY RUN (no changes made)")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Remove CyberStrike artifacts and restore macOS target state.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 cleanup_mac.py\n"
            "  sudo python3 cleanup_mac.py --dry-run\n"
            "  sudo python3 cleanup_mac.py --json-output\n"
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Show what would be cleaned without making changes",
    )
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    cleaner = MacCleaner(args)
    cleaner.run()


if __name__ == "__main__":
    main()
