#!/usr/bin/env python3
"""
dtrace_net.py - Monitor network connections via DTrace on macOS.

Uses the ip:::send and ip:::receive DTrace probes to intercept all IPv4
network traffic on the system. Captures source/destination addresses and
ports, process information, packet direction, and payload length.
Includes deduplication of rapid-fire events. Requires root privileges
and may require SIP to be partially disabled for full functionality.

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
ip:::send
{
    printf("NET|send|%d|%s|%s|%d|%s|%d|%d", pid, execname, args[2]->ip_saddr, args[4]->ipv4_sport, args[2]->ip_daddr, args[4]->ipv4_dport, args[2]->ip_plength);
}

ip:::receive
{
    printf("NET|recv|%d|%s|%s|%d|%s|%d|%d", pid, execname, args[2]->ip_saddr, args[4]->ipv4_sport, args[2]->ip_daddr, args[4]->ipv4_dport, args[2]->ip_plength);
}
"""

NOISE_PROCESSES = frozenset({
    "dtrace",
    "kernel_task",
    "mDNSResponder",
})

# Deduplication window in seconds
DEDUP_WINDOW = 0.05


class NetMonitor:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.bytes_total = 0
        self.start_time = None
        self.running = True
        self.proc = None
        self.last_events = {}

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: dtrace_net.py requires root privileges. Run with sudo.", file=sys.stderr)
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
        print("  dtrace_net.py - Network Connection Monitor (DTrace)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Probes:      ip:::send, ip:::receive")
        print(f"  JSON output: {self.args.json_output}")
        if self.args.duration:
            print(f"  Duration:    {self.args.duration}s")
        else:
            print("  Duration:    unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def is_duplicate(self, dedup_key, now):
        """Check if this event is a duplicate within the dedup window."""
        last_seen = self.last_events.get(dedup_key)
        if last_seen is not None and (now - last_seen) < DEDUP_WINDOW:
            return True
        self.last_events[dedup_key] = now
        # Prune old entries periodically to prevent memory growth
        if len(self.last_events) > 10000:
            cutoff = now - DEDUP_WINDOW * 2
            self.last_events = {
                k: v for k, v in self.last_events.items() if v > cutoff
            }
        return False

    def parse_line(self, line):
        """Parse a DTrace output line in the format NET|dir|pid|exec|saddr|sport|daddr|dport|bytes."""
        line = line.strip()
        if not line.startswith("NET|"):
            return None

        parts = line.split("|")
        if len(parts) < 9:
            return None

        try:
            direction = parts[1]
            pid = int(parts[2])
            process = parts[3]
            src_ip = parts[4]
            src_port = int(parts[5])
            dst_ip = parts[6]
            dst_port = int(parts[7])
            bytes_len = int(parts[8])
        except (ValueError, IndexError):
            return None

        if process in NOISE_PROCESSES:
            return None

        now = time.monotonic()
        dedup_key = f"{direction}:{pid}:{src_ip}:{src_port}:{dst_ip}:{dst_port}"
        if self.is_duplicate(dedup_key, now):
            return None

        return {
            "timestamp": datetime.now().isoformat(),
            "direction": direction,
            "pid": pid,
            "process": process,
            "src_ip": src_ip,
            "src_port": src_port,
            "dst_ip": dst_ip,
            "dst_port": dst_port,
            "bytes": bytes_len,
        }

    def run(self):
        self.check_root()
        self.check_sip()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        print("Tracing network connections... Hit Ctrl+C to stop.\n")
        if not self.args.json_output:
            print(
                f"{'TIMESTAMP':<28} {'DIR':<6} {'PID':<10} "
                f"{'PROCESS':<18} {'SRC_IP':<18} {'SPORT':<8} "
                f"{'DST_IP':<18} {'DPORT':<8} {'BYTES'}"
            )
            print("-" * 140)

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
                self.bytes_total += record["bytes"]

                if self.args.json_output:
                    print(json.dumps(record), flush=True)
                else:
                    print(
                        f"[{record['timestamp']}] "
                        f"{record['direction']:<5} "
                        f"PID={record['pid']:<8} "
                        f"PROC={record['process']:<16} "
                        f"SRC={record['src_ip']}:{record['src_port']:<6} "
                        f"DST={record['dst_ip']}:{record['dst_port']:<6} "
                        f"BYTES={record['bytes']}",
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

        print(f"\n--- dtrace_net summary ---")
        print(f"Captured {self.event_count} network event(s)")
        print(f"Total bytes observed: {self.bytes_total}")
        if self.start_time:
            elapsed = time.monotonic() - self.start_time
            print(f"Duration: {elapsed:.1f}s")
        print("DTrace probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor network connections via DTrace ip:::send and ip:::receive probes on macOS.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 dtrace_net.py\n"
            "  sudo python3 dtrace_net.py --json-output --duration 60\n"
            "  sudo python3 dtrace_net.py --json-output | jq 'select(.dst_port == 443)'"
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

    monitor = NetMonitor(args)
    monitor.run()


if __name__ == "__main__":
    main()
