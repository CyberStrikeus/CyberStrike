#!/usr/bin/env python3
"""
dtrace_exec.py - Monitor all process executions via DTrace on macOS.

Uses the syscall::execve:return DTrace probe to intercept every new process
execution on the system. Captures PID, PPID, UID, command name, and full
command-line arguments. Requires root privileges and may require SIP to be
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
syscall::execve:return
/execname != "dtrace"/
{
    printf("EXEC|%d|%d|%d|%s|%s", pid, ppid, uid, execname, curpsinfo->pr_psargs);
}
"""

NOISE_PROCESSES = frozenset({
    "dtrace",
    "kernel_task",
    "launchd",
    "syslogd",
})


class ExecMonitor:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.proc = None

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: dtrace_exec.py requires root privileges. Run with sudo.", file=sys.stderr)
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
        print("  dtrace_exec.py - Process Execution Monitor (DTrace)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Probe:       syscall::execve:return")
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
        """Parse a DTrace output line in the format EXEC|pid|ppid|uid|execname|args."""
        line = line.strip()
        if not line.startswith("EXEC|"):
            return None

        parts = line.split("|", 5)
        if len(parts) < 6:
            return None

        try:
            pid = int(parts[1])
            ppid = int(parts[2])
            uid = int(parts[3])
        except ValueError:
            return None

        execname = parts[4]
        full_command = parts[5]

        if execname in NOISE_PROCESSES:
            return None

        return {
            "timestamp": datetime.now().isoformat(),
            "pid": pid,
            "ppid": ppid,
            "uid": uid,
            "execname": execname,
            "full_command": full_command,
        }

    def run(self):
        self.check_root()
        self.check_sip()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        print("Tracing process executions... Hit Ctrl+C to stop.\n")
        if not self.args.json_output:
            print(
                f"{'TIMESTAMP':<28} {'PID':<10} {'PPID':<10} "
                f"{'UID':<8} {'EXECNAME':<20} {'COMMAND'}"
            )
            print("-" * 120)

        self.start_time = time.monotonic()

        try:
            self.proc = subprocess.Popen(
                ["dtrace", "-n", DTRACE_SCRIPT],
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
                    print(json.dumps(record), flush=True)
                else:
                    print(
                        f"[{record['timestamp']}] "
                        f"PID={record['pid']:<8} "
                        f"PPID={record['ppid']:<8} "
                        f"UID={record['uid']:<6} "
                        f"EXEC={record['execname']:<18} "
                        f"CMD={record['full_command']}",
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

        print(f"\n--- dtrace_exec summary ---")
        print(f"Captured {self.event_count} execve event(s)")
        if self.start_time:
            elapsed = time.monotonic() - self.start_time
            print(f"Duration: {elapsed:.1f}s")
        print("DTrace probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor all process executions via DTrace on macOS.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 dtrace_exec.py\n"
            "  sudo python3 dtrace_exec.py --json-output --duration 120\n"
            "  sudo python3 dtrace_exec.py --json-output | jq '.execname'"
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

    monitor = ExecMonitor(args)
    monitor.run()


if __name__ == "__main__":
    main()
