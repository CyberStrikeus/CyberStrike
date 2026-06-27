#!/usr/bin/env python3
"""
dtrace_file.py - Monitor file access via DTrace on macOS.

Uses the syscall::open*:entry DTrace probe to intercept all file open
operations on the system. Captures PID, UID, process name, file path,
and access flags (translated to human-readable names). Supports filtering
by a specific PID. Requires root privileges and may require SIP to be
partially disabled for full functionality.

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


DTRACE_SCRIPT = r"""
syscall::open*:entry
{
    printf("FILE|%d|%d|%s|%s|%d", pid, uid, execname, copyinstr(arg0), arg1);
}
"""

DTRACE_SCRIPT_PID = r"""
syscall::open*:entry
/pid == $target/
{
    printf("FILE|%d|%d|%s|%s|%d", pid, uid, execname, copyinstr(arg0), arg1);
}
"""

NOISE_PROCESSES = frozenset({
    "dtrace",
    "kernel_task",
    "launchd",
    "syslogd",
    "mds",
    "mds_stores",
    "mdworker_shared",
    "fseventsd",
    "notifyd",
    "distnoted",
})

# macOS open(2) flags — values from <sys/fcntl.h>
O_FLAGS = {
    0x0000: "O_RDONLY",
    0x0001: "O_WRONLY",
    0x0002: "O_RDWR",
    0x0008: "O_APPEND",
    0x0200: "O_CREAT",
    0x0400: "O_TRUNC",
    0x0800: "O_EXCL",
    0x0004: "O_NONBLOCK",
    0x0010: "O_SHLOCK",
    0x0020: "O_EXLOCK",
    0x1000: "O_NOFOLLOW",
    0x8000: "O_SYMLINK",
    0x20000: "O_CLOEXEC",
    0x100000: "O_DIRECTORY",
}


def decode_flags(flags_int):
    """Convert numeric open(2) flags to a human-readable string."""
    if flags_int == 0:
        return "O_RDONLY"

    # Access mode is in the low 2 bits
    access_mode = flags_int & 0x0003
    result = []

    if access_mode == 0:
        result.append("O_RDONLY")
    elif access_mode == 1:
        result.append("O_WRONLY")
    elif access_mode == 2:
        result.append("O_RDWR")

    # Check remaining flags (skip the access mode bits)
    remaining = flags_int & ~0x0003
    for bit, name in O_FLAGS.items():
        if bit <= 0x0002:
            continue
        if remaining & bit:
            result.append(name)

    if not result:
        return f"0x{flags_int:04x}"

    return "|".join(result)


class FileMonitor:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.proc = None

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: dtrace_file.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def check_sip(self):
        """Warn if System Integrity Protection is fully enabled."""
        try:
            result = subprocess.run(
                ["csrutil", "status"],
                capture_output=True, text=True, timeout=5,
            )
            output = result.stdout.strip()
            if "enabled" in output.lower() and "disabled" not in output.lower():
                print(
                    "WARNING: System Integrity Protection (SIP) is enabled. "
                    "DTrace probes may be restricted. Consider partially "
                    "disabling SIP for full tracing capability.",
                    file=sys.stderr,
                )
        except Exception:
            pass

    def print_banner(self):
        print("=" * 70)
        print("  dtrace_file.py - File Access Monitor (DTrace)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Probe:       syscall::open*:entry")
        if self.args.pid:
            print(f"  Target PID:  {self.args.pid}")
        else:
            print("  Target PID:  all processes")
        print(f"  JSON output: {self.args.json_output}")
        if self.args.duration:
            print(f"  Duration:    {self.args.duration}s")
        else:
            print("  Duration:    unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def parse_line(self, line):
        """Parse a DTrace output line in the format FILE|pid|uid|execname|path|flags."""
        line = line.strip()
        if not line.startswith("FILE|"):
            return None

        parts = line.split("|", 5)
        if len(parts) < 6:
            return None

        try:
            pid = int(parts[1])
            uid = int(parts[2])
        except ValueError:
            return None

        process = parts[3]
        path = parts[4]

        try:
            flags_int = int(parts[5])
        except ValueError:
            flags_int = 0

        if process in NOISE_PROCESSES:
            return None

        flags_str = decode_flags(flags_int)

        return {
            "timestamp": datetime.now().isoformat(),
            "pid": pid,
            "uid": uid,
            "process": process,
            "path": path,
            "flags": flags_str,
            "flags_raw": flags_int,
        }

    def run(self):
        self.check_root()
        self.check_sip()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        print("Tracing file access... Hit Ctrl+C to stop.\n")
        if not self.args.json_output:
            print(
                f"{'TIMESTAMP':<28} {'PID':<10} {'UID':<8} "
                f"{'PROCESS':<20} {'FLAGS':<24} {'PATH'}"
            )
            print("-" * 130)

        self.start_time = time.monotonic()

        # Select the appropriate DTrace script based on --pid flag
        if self.args.pid:
            dtrace_cmd = [
                "dtrace", "-n", DTRACE_SCRIPT_PID,
                "-p", str(self.args.pid),
            ]
        else:
            dtrace_cmd = ["dtrace", "-n", DTRACE_SCRIPT]

        try:
            self.proc = subprocess.Popen(
                dtrace_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                bufsize=1,
            )

            while self.running:
                if self.args.duration:
                    elapsed = time.monotonic() - self.start_time
                    if elapsed >= self.args.duration:
                        break

                line = self.proc.stdout.readline()
                if not line:
                    if self.proc.poll() is not None:
                        break
                    continue

                record = self.parse_line(line)
                if record is None:
                    continue

                self.event_count += 1

                if self.args.json_output:
                    output = {
                        "timestamp": record["timestamp"],
                        "pid": record["pid"],
                        "uid": record["uid"],
                        "process": record["process"],
                        "path": record["path"],
                        "flags": record["flags"],
                        "flags_raw": record["flags_raw"],
                    }
                    print(json.dumps(output), flush=True)
                else:
                    print(
                        f"[{record['timestamp']}] "
                        f"PID={record['pid']:<8} "
                        f"UID={record['uid']:<6} "
                        f"PROC={record['process']:<18} "
                        f"FLAGS={record['flags']:<22} "
                        f"PATH={record['path']}",
                        flush=True,
                    )

        except Exception as exc:
            print(f"ERROR: DTrace execution failed: {exc}", file=sys.stderr)
        finally:
            self.cleanup()

    def cleanup(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()

        print(f"\n--- dtrace_file summary ---")
        print(f"Captured {self.event_count} file access event(s)")
        if self.start_time:
            elapsed = time.monotonic() - self.start_time
            print(f"Duration: {elapsed:.1f}s")
        print("DTrace probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor file access via DTrace syscall::open*:entry probe on macOS.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 dtrace_file.py\n"
            "  sudo python3 dtrace_file.py --pid 1234 --json-output\n"
            "  sudo python3 dtrace_file.py --duration 30 --json-output | jq '.path'"
        ),
    )
    parser.add_argument(
        "--pid",
        type=int,
        default=None,
        metavar="PID",
        help="Filter file access events for a specific process ID",
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

    monitor = FileMonitor(args)
    monitor.run()


if __name__ == "__main__":
    main()
