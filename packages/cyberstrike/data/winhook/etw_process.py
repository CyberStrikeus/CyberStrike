#!/usr/bin/env python3
"""
etw_process.py - Monitor process creation and termination on Windows.

Polls the system process list via tasklist at 1-second intervals and diffs
successive snapshots to detect newly created and terminated processes.
Captures PID, process name, session, memory usage, username, and window
title. Requires Administrator privileges.

Part of CyberStrike offensive security platform.
"""

import argparse
import csv
import ctypes
import io
import json
import os
import signal
import subprocess
import sys
import time
from datetime import datetime


class ProcessMonitor:
    """Polls tasklist to detect process creation and termination events."""

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.previous_pids = {}

    def check_admin(self):
        try:
            is_admin = ctypes.windll.shell32.IsUserAnAdmin()
        except AttributeError:
            print(
                "ERROR: etw_process.py requires Windows with Administrator privileges.",
                file=sys.stderr,
            )
            sys.exit(1)
        if not is_admin:
            print(
                "ERROR: etw_process.py requires Administrator privileges. "
                "Run from an elevated prompt.",
                file=sys.stderr,
            )
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  etw_process.py - Process Creation/Termination Monitor (Windows)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Method:      tasklist polling (1s interval)")
        print(f"  JSON output: {self.args.json_output}")
        if self.args.duration:
            print(f"  Duration:    {self.args.duration}s")
        else:
            print("  Duration:    unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def snapshot_processes(self):
        """Run tasklist /V /FO CSV and return a dict of pid -> process info."""
        try:
            result = subprocess.run(
                ["tasklist", "/V", "/FO", "CSV"],
                capture_output=True,
                text=True,
                timeout=10,
            )
        except FileNotFoundError:
            print(
                "ERROR: tasklist command not found. This script requires Windows.",
                file=sys.stderr,
            )
            sys.exit(1)
        except subprocess.TimeoutExpired:
            return {}

        if result.returncode != 0:
            return {}

        processes = {}
        reader = csv.DictReader(io.StringIO(result.stdout))
        for row in reader:
            try:
                pid = int(row.get("PID", "0"))
            except (ValueError, TypeError):
                continue

            processes[pid] = {
                "pid": pid,
                "process_name": row.get("Image Name", ""),
                "session": row.get("Session Name", ""),
                "session_num": row.get("Session#", ""),
                "mem_usage": row.get("Mem Usage", ""),
                "status": row.get("Status", ""),
                "username": row.get("User Name", ""),
                "cpu_time": row.get("CPU Time", ""),
                "window_title": row.get("Window Title", ""),
            }

        return processes

    def emit_event(self, event_type, process_info):
        """Emit a process creation or termination event."""
        self.event_count += 1
        timestamp = datetime.now().isoformat()

        if self.args.json_output:
            record = {
                "timestamp": timestamp,
                "event_type": event_type,
                "pid": process_info["pid"],
                "process_name": process_info["process_name"],
                "session": process_info.get("session", ""),
                "mem_usage": process_info.get("mem_usage", ""),
                "username": process_info.get("username", ""),
                "window_title": process_info.get("window_title", ""),
            }
            print(json.dumps(record), flush=True)
        else:
            tag = "CREATED" if event_type == "created" else "TERMINATED"
            print(
                f"[{timestamp}] {tag:<12} "
                f"PID={process_info['pid']:<8} "
                f"NAME={process_info['process_name']:<28} "
                f"USER={process_info.get('username', 'N/A'):<24} "
                f"MEM={process_info.get('mem_usage', 'N/A')}",
                flush=True,
            )

    def run(self):
        self.check_admin()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        print("Taking initial process snapshot...")
        self.previous_pids = self.snapshot_processes()
        print(f"Baseline: {len(self.previous_pids)} processes. Monitoring...\n")

        if not self.args.json_output:
            print(
                f"{'TIMESTAMP':<28} {'EVENT':<14} "
                f"{'PID':<10} {'NAME':<30} "
                f"{'USER':<26} {'MEM'}"
            )
            print("-" * 130)

        self.start_time = time.monotonic()

        while self.running:
            time.sleep(1)

            current_pids = self.snapshot_processes()

            # Detect new processes
            for pid, info in current_pids.items():
                if pid not in self.previous_pids:
                    self.emit_event("created", info)

            # Detect terminated processes
            for pid, info in self.previous_pids.items():
                if pid not in current_pids:
                    self.emit_event("terminated", info)

            self.previous_pids = current_pids

            if self.args.duration:
                elapsed = time.monotonic() - self.start_time
                if elapsed >= self.args.duration:
                    break

        self.cleanup()

    def cleanup(self):
        print(f"\n--- etw_process summary ---")
        print(f"Captured {self.event_count} process event(s)")
        if self.start_time:
            elapsed = time.monotonic() - self.start_time
            print(f"Duration: {elapsed:.1f}s")
        print("Monitoring stopped. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor process creation and termination on Windows via tasklist polling.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python etw_process.py\n"
            "  python etw_process.py --json-output --duration 120\n"
            "  python etw_process.py --json-output | jq '.'"
        ),
    )
    parser.add_argument(
        "--json-output",
        action="store_true",
        default=False,
        help="Output events as JSON objects (one per line)",
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=None,
        metavar="SECONDS",
        help="Run for specified duration in seconds, then exit",
    )
    args = parser.parse_args()

    monitor = ProcessMonitor(args)
    monitor.run()


if __name__ == "__main__":
    main()
