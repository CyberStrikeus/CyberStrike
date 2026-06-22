#!/usr/bin/env python3
"""
etw_network.py - Monitor network connections on Windows.

Polls netstat -ano at 1-second intervals and diffs successive snapshots to
detect newly established and closed network connections. Resolves PIDs to
process names via tasklist. Requires Administrator privileges.

Part of CyberStrike offensive security platform.
"""

import argparse
import csv
import ctypes
import io
import json
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime


class NetworkMonitor:
    """Polls netstat to detect new and closed network connections."""

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.previous_conns = {}
        self.pid_name_cache = {}
        self.cache_ttl = 5
        self.cache_time = 0

    def check_admin(self):
        try:
            is_admin = ctypes.windll.shell32.IsUserAnAdmin()
        except AttributeError:
            print(
                "ERROR: etw_network.py requires Windows with Administrator privileges.",
                file=sys.stderr,
            )
            sys.exit(1)
        if not is_admin:
            print(
                "ERROR: etw_network.py requires Administrator privileges. "
                "Run from an elevated prompt.",
                file=sys.stderr,
            )
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  etw_network.py - Network Connection Monitor (Windows)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Method:      netstat polling (1s interval)")
        print(f"  JSON output: {self.args.json_output}")
        if self.args.duration:
            print(f"  Duration:    {self.args.duration}s")
        else:
            print("  Duration:    unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def refresh_pid_cache(self):
        """Build a PID-to-process-name mapping via tasklist."""
        now = time.monotonic()
        if now - self.cache_time < self.cache_ttl:
            return

        try:
            result = subprocess.run(
                ["tasklist", "/FO", "CSV", "/NH"],
                capture_output=True,
                text=True,
                timeout=10,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return

        if result.returncode != 0:
            return

        cache = {}
        reader = csv.reader(io.StringIO(result.stdout))
        for row in reader:
            if len(row) >= 2:
                try:
                    pid = int(row[1])
                    cache[pid] = row[0]
                except (ValueError, IndexError):
                    continue

        self.pid_name_cache = cache
        self.cache_time = now

    def parse_address(self, addr_str):
        """Split an address string like '192.168.1.1:443' or '[::1]:80' into (addr, port)."""
        addr_str = addr_str.strip()
        if not addr_str or addr_str == "*:*":
            return ("*", 0)

        # IPv6: [addr]:port
        ipv6_match = re.match(r"^\[(.+)\]:(\d+)$", addr_str)
        if ipv6_match:
            return (ipv6_match.group(1), int(ipv6_match.group(2)))

        # IPv4: addr:port — split on the last colon
        last_colon = addr_str.rfind(":")
        if last_colon == -1:
            return (addr_str, 0)

        addr_part = addr_str[:last_colon]
        try:
            port = int(addr_str[last_colon + 1:])
        except ValueError:
            port = 0

        return (addr_part, port)

    def snapshot_connections(self):
        """Run netstat -ano and return a dict of connection tuples -> info."""
        try:
            result = subprocess.run(
                ["netstat", "-ano"],
                capture_output=True,
                text=True,
                timeout=10,
            )
        except FileNotFoundError:
            print(
                "ERROR: netstat command not found. This script requires Windows.",
                file=sys.stderr,
            )
            sys.exit(1)
        except subprocess.TimeoutExpired:
            return {}

        if result.returncode != 0:
            return {}

        connections = {}
        # netstat -ano output lines:
        #   Proto  Local Address          Foreign Address        State           PID
        #   TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1234
        line_pattern = re.compile(
            r"^\s*(TCP|UDP)\s+(\S+)\s+(\S+)\s+(\S+)?\s+(\d+)\s*$"
        )

        for line in result.stdout.splitlines():
            match = line_pattern.match(line)
            if not match:
                # UDP lines may lack a state column
                udp_match = re.match(
                    r"^\s*(UDP)\s+(\S+)\s+(\S+)\s+(\d+)\s*$", line
                )
                if udp_match:
                    proto = udp_match.group(1)
                    local_addr_str = udp_match.group(2)
                    remote_addr_str = udp_match.group(3)
                    state = ""
                    pid = int(udp_match.group(4))
                else:
                    continue
            else:
                proto = match.group(1)
                local_addr_str = match.group(2)
                remote_addr_str = match.group(3)
                state = match.group(4) if match.group(4) else ""
                pid = int(match.group(5))

            local_addr, local_port = self.parse_address(local_addr_str)
            remote_addr, remote_port = self.parse_address(remote_addr_str)

            conn_key = (proto, local_addr, local_port, remote_addr, remote_port, state, pid)
            connections[conn_key] = {
                "protocol": proto,
                "local_address": local_addr,
                "local_port": local_port,
                "remote_address": remote_addr,
                "remote_port": remote_port,
                "state": state,
                "pid": pid,
            }

        return connections

    def resolve_pid(self, pid):
        """Resolve a PID to a process name from the cache."""
        return self.pid_name_cache.get(pid, f"PID:{pid}")

    def emit_event(self, event_type, conn_info):
        """Emit a connection event."""
        self.event_count += 1
        timestamp = datetime.now().isoformat()
        process_name = self.resolve_pid(conn_info["pid"])

        if self.args.json_output:
            record = {
                "timestamp": timestamp,
                "event_type": event_type,
                "protocol": conn_info["protocol"],
                "local_address": conn_info["local_address"],
                "local_port": conn_info["local_port"],
                "remote_address": conn_info["remote_address"],
                "remote_port": conn_info["remote_port"],
                "state": conn_info["state"],
                "pid": conn_info["pid"],
                "process_name": process_name,
            }
            print(json.dumps(record), flush=True)
        else:
            tag = "NEW" if event_type == "new" else "CLOSED"
            local = f"{conn_info['local_address']}:{conn_info['local_port']}"
            remote = f"{conn_info['remote_address']}:{conn_info['remote_port']}"
            print(
                f"[{timestamp}] {tag:<8} "
                f"{conn_info['protocol']:<6} "
                f"{local:<24} -> {remote:<24} "
                f"{conn_info['state']:<14} "
                f"PID={conn_info['pid']:<8} "
                f"{process_name}",
                flush=True,
            )

    def run(self):
        self.check_admin()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        print("Taking initial connection snapshot...")
        self.refresh_pid_cache()
        self.previous_conns = self.snapshot_connections()
        print(f"Baseline: {len(self.previous_conns)} connections. Monitoring...\n")

        if not self.args.json_output:
            print(
                f"{'TIMESTAMP':<28} {'EVENT':<10} "
                f"{'PROTO':<8} {'LOCAL':<26} {'REMOTE':<26} "
                f"{'STATE':<16} {'PID':<10} {'PROCESS'}"
            )
            print("-" * 150)

        self.start_time = time.monotonic()

        while self.running:
            time.sleep(1)

            self.refresh_pid_cache()
            current_conns = self.snapshot_connections()

            # Detect new connections
            for key, info in current_conns.items():
                if key not in self.previous_conns:
                    self.emit_event("new", info)

            # Detect closed connections
            for key, info in self.previous_conns.items():
                if key not in current_conns:
                    self.emit_event("closed", info)

            self.previous_conns = current_conns

            if self.args.duration:
                elapsed = time.monotonic() - self.start_time
                if elapsed >= self.args.duration:
                    break

        self.cleanup()

    def cleanup(self):
        print(f"\n--- etw_network summary ---")
        print(f"Captured {self.event_count} connection event(s)")
        if self.start_time:
            elapsed = time.monotonic() - self.start_time
            print(f"Duration: {elapsed:.1f}s")
        print("Monitoring stopped. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor network connections on Windows via netstat polling.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python etw_network.py\n"
            "  python etw_network.py --json-output --duration 60\n"
            "  python etw_network.py --json-output | jq '.'"
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

    monitor = NetworkMonitor(args)
    monitor.run()


if __name__ == "__main__":
    main()
