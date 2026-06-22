#!/usr/bin/env python3
"""
xprotect_check.py — Enumerate macOS XProtect, MRT, Gatekeeper, and SIP status.

Read-only reconnaissance tool that checks macOS security subsystem versions,
enumerates XProtect YARA rule names, and reports defensive posture.

No root required — all checks use publicly readable paths and commands.

Part of CyberStrike offensive security platform.
"""

import argparse
import json
import os
import plistlib
import re
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path


XPROTECT_PATHS = [
    "/Library/Apple/System/Library/CoreServices/XProtect.bundle",
    "/System/Library/CoreServices/XProtect.bundle",
]

MRT_PATHS = [
    "/Library/Apple/System/Library/CoreServices/MRT.app",
    "/System/Library/CoreServices/MRT.app",
]

XPROTECT_REMEDIATOR_PATH = (
    "/Library/Apple/System/Library/CoreServices/XProtect.app"
)


class XProtectChecker:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True

    def print_banner(self):
        print("=" * 60)
        print("CyberStrike — XProtect / Security Posture Check (macOS)")
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
            category = record.get("category", "N/A")
            name = record.get("name", "N/A")
            value = record.get("value", "N/A")
            print(f"[{category:<16}] {name:<35} {value}", flush=True)

    def get_macos_version(self):
        """Get macOS version info."""
        try:
            result = subprocess.run(
                ["sw_vers"], capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                info = {}
                for line in result.stdout.strip().splitlines():
                    if ":" in line:
                        key, val = line.split(":", 1)
                        info[key.strip()] = val.strip()
                self.emit(
                    {
                        "timestamp": datetime.now().isoformat(),
                        "category": "system",
                        "name": "macOS Version",
                        "value": info.get("ProductVersion", "unknown"),
                        "build": info.get("BuildVersion", "unknown"),
                        "product": info.get("ProductName", "unknown"),
                    }
                )
        except Exception:
            pass

    def check_sip(self):
        """Check System Integrity Protection status."""
        try:
            result = subprocess.run(
                ["csrutil", "status"], capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                output = result.stdout.strip()
                enabled = "enabled" in output.lower()
                self.emit(
                    {
                        "timestamp": datetime.now().isoformat(),
                        "category": "sip",
                        "name": "System Integrity Protection",
                        "value": "enabled" if enabled else "DISABLED",
                        "raw": output,
                        "exploitable": not enabled,
                    }
                )
        except Exception:
            pass

    def check_gatekeeper(self):
        """Check Gatekeeper status."""
        try:
            result = subprocess.run(
                ["spctl", "--status"], capture_output=True, text=True, timeout=5
            )
            output = (result.stdout.strip() + " " + result.stderr.strip()).strip()
            enabled = "enabled" in output.lower() or "assessments enabled" in output.lower()
            self.emit(
                {
                    "timestamp": datetime.now().isoformat(),
                    "category": "gatekeeper",
                    "name": "Gatekeeper",
                    "value": "enabled" if enabled else "DISABLED",
                    "raw": output,
                    "exploitable": not enabled,
                }
            )
        except Exception:
            pass

    def check_xprotect(self):
        """Enumerate XProtect version and YARA rules."""
        xprotect_bundle = None
        for p in XPROTECT_PATHS:
            if Path(p).exists():
                xprotect_bundle = Path(p)
                break

        if not xprotect_bundle:
            self.emit(
                {
                    "timestamp": datetime.now().isoformat(),
                    "category": "xprotect",
                    "name": "XProtect Bundle",
                    "value": "NOT FOUND",
                }
            )
            return

        info_plist = xprotect_bundle / "Contents" / "Info.plist"
        if info_plist.exists():
            try:
                with open(info_plist, "rb") as f:
                    plist = plistlib.load(f)
                version = plist.get("CFBundleShortVersionString", "unknown")
                self.emit(
                    {
                        "timestamp": datetime.now().isoformat(),
                        "category": "xprotect",
                        "name": "XProtect Version",
                        "value": version,
                        "path": str(xprotect_bundle),
                    }
                )
            except Exception:
                pass

        yara_path = xprotect_bundle / "Contents" / "Resources" / "XProtect.yara"
        if yara_path.exists():
            try:
                content = yara_path.read_text(errors="replace")
                rules = re.findall(r"^rule\s+(\S+)", content, re.MULTILINE)
                self.emit(
                    {
                        "timestamp": datetime.now().isoformat(),
                        "category": "xprotect",
                        "name": "YARA Rules Count",
                        "value": str(len(rules)),
                        "yara_path": str(yara_path),
                    }
                )
                for rule_name in rules:
                    if not self.running:
                        break
                    self.emit(
                        {
                            "timestamp": datetime.now().isoformat(),
                            "category": "xprotect_rule",
                            "name": rule_name,
                            "value": "active",
                        }
                    )
            except Exception:
                pass

        meta_plist = (
            xprotect_bundle / "Contents" / "Resources" / "XProtect.meta.plist"
        )
        if meta_plist.exists():
            try:
                with open(meta_plist, "rb") as f:
                    meta = plistlib.load(f)
                plugin_blacklist = meta.get("PlugInBlacklist", {})
                blocked_count = 0
                for plugin_id, versions in plugin_blacklist.items():
                    if isinstance(versions, dict):
                        for key, val in versions.items():
                            if isinstance(val, dict):
                                min_ver = val.get("MinimumPlugInBundleVersion", "")
                                if min_ver:
                                    blocked_count += 1
                self.emit(
                    {
                        "timestamp": datetime.now().isoformat(),
                        "category": "xprotect",
                        "name": "Blocked Plugins",
                        "value": str(blocked_count),
                    }
                )
            except Exception:
                pass

    def check_mrt(self):
        """Check MRT (Malware Removal Tool) version."""
        for mrt_path in MRT_PATHS:
            p = Path(mrt_path)
            if p.exists():
                info_plist = p / "Contents" / "Info.plist"
                if info_plist.exists():
                    try:
                        with open(info_plist, "rb") as f:
                            plist = plistlib.load(f)
                        version = plist.get("CFBundleShortVersionString", "unknown")
                        self.emit(
                            {
                                "timestamp": datetime.now().isoformat(),
                                "category": "mrt",
                                "name": "MRT Version",
                                "value": version,
                                "path": mrt_path,
                            }
                        )
                    except Exception:
                        pass
                return

        xprotect_app = Path(XPROTECT_REMEDIATOR_PATH)
        if xprotect_app.exists():
            info_plist = xprotect_app / "Contents" / "Info.plist"
            if info_plist.exists():
                try:
                    with open(info_plist, "rb") as f:
                        plist = plistlib.load(f)
                    version = plist.get("CFBundleShortVersionString", "unknown")
                    self.emit(
                        {
                            "timestamp": datetime.now().isoformat(),
                            "category": "xprotect_remediator",
                            "name": "XProtect Remediator Version",
                            "value": version,
                            "path": XPROTECT_REMEDIATOR_PATH,
                        }
                    )
                except Exception:
                    pass

    def check_firewall(self):
        """Check macOS Application Firewall status."""
        try:
            result = subprocess.run(
                ["/usr/libexec/ApplicationFirewall/socketfilterfw", "--getglobalstate"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0:
                output = result.stdout.strip()
                enabled = "enabled" in output.lower()
                self.emit(
                    {
                        "timestamp": datetime.now().isoformat(),
                        "category": "firewall",
                        "name": "Application Firewall",
                        "value": "enabled" if enabled else "DISABLED",
                        "raw": output,
                        "exploitable": not enabled,
                    }
                )
        except Exception:
            pass

        try:
            result = subprocess.run(
                ["/usr/libexec/ApplicationFirewall/socketfilterfw", "--getstealthmode"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0:
                output = result.stdout.strip()
                enabled = "enabled" in output.lower()
                self.emit(
                    {
                        "timestamp": datetime.now().isoformat(),
                        "category": "firewall",
                        "name": "Stealth Mode",
                        "value": "enabled" if enabled else "DISABLED",
                        "raw": output,
                    }
                )
        except Exception:
            pass

    def check_filevault(self):
        """Check FileVault status."""
        try:
            result = subprocess.run(
                ["fdesetup", "status"], capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                output = result.stdout.strip()
                enabled = "on" in output.lower() or "encryption" in output.lower()
                self.emit(
                    {
                        "timestamp": datetime.now().isoformat(),
                        "category": "filevault",
                        "name": "FileVault",
                        "value": "enabled" if enabled else "DISABLED",
                        "raw": output,
                    }
                )
        except Exception:
            pass

    def check_edr(self):
        """Check for common macOS EDR/AV products."""
        edr_indicators = {
            "CrowdStrike Falcon": [
                "/Library/CS/falcond",
                "/Applications/Falcon.app",
            ],
            "Carbon Black": [
                "/Applications/VMware Carbon Black Cloud/VMware CBCloud.app",
                "/Library/Application Support/com.vmware.carbonblack.cloud",
            ],
            "SentinelOne": [
                "/Library/Sentinel/sentinel-agent.bundle",
            ],
            "Jamf Protect": [
                "/Library/Application Support/JamfProtect",
            ],
            "Sophos": [
                "/Library/Sophos Anti-Virus",
            ],
            "Malwarebytes": [
                "/Library/Application Support/Malwarebytes",
            ],
            "Norton": [
                "/Applications/Norton Security.app",
            ],
            "ESET": [
                "/Applications/ESET Endpoint Security.app",
                "/Applications/ESET Cyber Security.app",
            ],
        }

        for product, paths in edr_indicators.items():
            if not self.running:
                break
            found = False
            found_path = ""
            for indicator_path in paths:
                if Path(indicator_path).exists():
                    found = True
                    found_path = indicator_path
                    break
            if found:
                self.emit(
                    {
                        "timestamp": datetime.now().isoformat(),
                        "category": "edr",
                        "name": product,
                        "value": "INSTALLED",
                        "path": found_path,
                    }
                )

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        checks = [
            self.get_macos_version,
            self.check_sip,
            self.check_gatekeeper,
            self.check_xprotect,
            self.check_mrt,
            self.check_firewall,
            self.check_filevault,
            self.check_edr,
        ]

        for check in checks:
            if not self.running:
                break
            check()

        self.cleanup()

    def cleanup(self):
        print(f"\n--- xprotect_check summary ---")
        print(f"Items found: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Enumerate macOS XProtect, Gatekeeper, SIP, and EDR status.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 xprotect_check.py\n"
            "  python3 xprotect_check.py --json-output\n"
            "  python3 xprotect_check.py --json-output | jq 'select(.exploitable == true)'\n"
        ),
    )
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    checker = XProtectChecker(args)
    checker.run()


if __name__ == "__main__":
    main()
