#!/usr/bin/env python3
"""
crossmem_sniff.py - Monitor cross-process memory operations via eBPF.

Attaches to syscalls:sys_enter_process_vm_writev and sys_enter_process_vm_readv
tracepoints to detect stealthy memory injection that bypasses ptrace-based
detection. Requires root privileges.

Part of CyberStrike offensive security platform.
"""

import argparse
import ctypes
import json
import os
import signal
import sys
import time
from datetime import datetime

TASK_COMM_LEN = 16

BPF_PROGRAM = r"""
#include <uapi/linux/ptrace.h>
#include <linux/sched.h>

struct crossmem_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u32 target_pid;
    u8  direction;      // 0=readv, 1=writev
    u64 total_len;
    u32 liovcnt;
    u32 riovcnt;
    u64 remote_addr;
    char comm[TASK_COMM_LEN];
};

BPF_PERF_OUTPUT(crossmem_events);

TRACEPOINT_PROBE(syscalls, sys_enter_process_vm_writev) {
    struct crossmem_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.target_pid = (u32)args->pid;
    event.direction = 1;
    event.liovcnt = (u32)args->liovcnt;
    event.riovcnt = (u32)args->riovcnt;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    // Read first remote iovec to get target address and length
    struct iovec riov = {};
    bpf_probe_read_user(&riov, sizeof(riov), (void *)args->rvec);
    event.remote_addr = (u64)riov.iov_base;
    event.total_len = riov.iov_len;

    crossmem_events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_process_vm_readv) {
    struct crossmem_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.target_pid = (u32)args->pid;
    event.direction = 0;
    event.liovcnt = (u32)args->liovcnt;
    event.riovcnt = (u32)args->riovcnt;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    struct iovec riov = {};
    bpf_probe_read_user(&riov, sizeof(riov), (void *)args->rvec);
    event.remote_addr = (u64)riov.iov_base;
    event.total_len = riov.iov_len;

    crossmem_events.perf_submit(args, &event, sizeof(event));
    return 0;
}
"""


class CrossMemEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("target_pid", ctypes.c_uint32),
        ("direction", ctypes.c_uint8),
        ("total_len", ctypes.c_uint64),
        ("liovcnt", ctypes.c_uint32),
        ("riovcnt", ctypes.c_uint32),
        ("remote_addr", ctypes.c_uint64),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
    ]


class CrossMemSniffer:
    DIRECTION_NAMES = {0: "READ", 1: "WRITE"}

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.alert_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None
        self.write_tracker = {}  # target_pid -> {count, total_bytes, attacker_pid}

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: crossmem_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  crossmem_sniff.py - Cross-Process Memory Monitor (eBPF)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Hooks:       process_vm_writev + process_vm_readv")
        print(f"  JSON output: {self.args.json_output}")
        if self.args.duration:
            print(f"  Duration:    {self.args.duration}s")
        else:
            print("  Duration:    unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def _get_target_comm(self, target_pid):
        """Read target process name from /proc."""
        try:
            with open(f"/proc/{target_pid}/comm", "r") as f:
                return f.read().strip()
        except (FileNotFoundError, PermissionError):
            return "unknown"

    def _check_rwx_mapping(self, target_pid, addr):
        """Check if target address falls in an RWX memory region."""
        try:
            with open(f"/proc/{target_pid}/maps", "r") as f:
                for line in f:
                    parts = line.split()
                    if len(parts) < 2:
                        continue
                    addr_range = parts[0].split("-")
                    perms = parts[1]
                    start = int(addr_range[0], 16)
                    end = int(addr_range[1], 16)
                    if start <= addr < end and "rwx" in perms:
                        return True
        except (FileNotFoundError, PermissionError, ValueError):
            pass
        return False

    def handle_event(self, cpu, data, size):
        event = ctypes.cast(data, ctypes.POINTER(CrossMemEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        direction = self.DIRECTION_NAMES.get(event.direction, "UNKNOWN")
        target_pid = event.target_pid
        pid = event.pid

        # Every cross-process write is suspicious by default
        alert = None
        severity = "info"

        if event.direction == 1:  # WRITE
            target_comm = self._get_target_comm(target_pid)

            # Track write operations
            if target_pid not in self.write_tracker:
                self.write_tracker[target_pid] = {"count": 0, "total_bytes": 0, "attacker_pid": pid}
            self.write_tracker[target_pid]["count"] += 1
            self.write_tracker[target_pid]["total_bytes"] += event.total_len

            # Check if writing to RWX region
            is_rwx = self._check_rwx_mapping(target_pid, event.remote_addr)
            if is_rwx:
                alert = "CODE_INJECTION"
                severity = "critical"
                self.alert_count += 1
            elif pid != target_pid:
                alert = "CROSS_PROCESS_WRITE"
                severity = "warning"
                self.alert_count += 1

            if alert and not self.args.json_output:
                print(
                    f"\n{'!'*70}\n"
                    f"  !!! {alert} DETECTED !!!\n"
                    f"  Attacker: PID={pid} ({comm})\n"
                    f"  Target:   PID={target_pid} ({target_comm})\n"
                    f"  Address:  {hex(event.remote_addr)}\n"
                    f"  Length:   {event.total_len} bytes\n"
                    f"  RWX mem:  {is_rwx}\n"
                    f"{'!'*70}\n",
                    flush=True,
                )

        elif event.direction == 0 and pid != target_pid:
            alert = "CROSS_PROCESS_READ"
            severity = "info"

        if self.args.json_output:
            record = {
                "timestamp": timestamp,
                "pid": pid,
                "uid": event.uid,
                "comm": comm,
                "target_pid": target_pid,
                "direction": direction,
                "remote_addr": hex(event.remote_addr),
                "total_len": event.total_len,
                "liovcnt": event.liovcnt,
                "riovcnt": event.riovcnt,
                "severity": severity,
            }
            if alert:
                record["alert"] = alert
                record["target_comm"] = self._get_target_comm(target_pid)
            print(json.dumps(record), flush=True)
        elif not alert:
            print(
                f"[{timestamp}] PID={pid:<8} UID={event.uid:<6} "
                f"COMM={comm:<16} DIR={direction:<8} "
                f"TARGET={target_pid:<8} ADDR={hex(event.remote_addr)} "
                f"LEN={event.total_len}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF

        self.bpf = BPF(text=BPF_PROGRAM)

        self.bpf["crossmem_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing cross-process memory operations... Hit Ctrl+C to stop.\n")
        if not self.args.json_output:
            print(
                f"{'TIMESTAMP':<28} {'PID':<12} {'UID':<10} "
                f"{'COMM':<20} {'DIR':<10} {'TARGET':<12} {'ADDR':<20} {'LEN'}"
            )
            print("-" * 130)

        self.start_time = time.monotonic()

        while self.running:
            try:
                self.bpf.perf_buffer_poll(timeout=100)
            except KeyboardInterrupt:
                self.running = False
                break

            if self.args.duration:
                elapsed = time.monotonic() - self.start_time
                if elapsed >= self.args.duration:
                    break

        self.cleanup()

    def cleanup(self):
        print(f"\n--- crossmem_sniff summary ---")
        print(f"Captured {self.event_count} event(s)")
        print(f"Alerts: {self.alert_count}")
        if self.write_tracker:
            print(f"Target PIDs with writes: {len(self.write_tracker)}")
            for tpid, info in self.write_tracker.items():
                print(f"  PID {tpid}: {info['count']} writes, {info['total_bytes']} bytes total")
        if self.start_time:
            elapsed = time.monotonic() - self.start_time
            print(f"Duration: {elapsed:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor cross-process memory operations (process_vm_writev/readv) via eBPF.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 crossmem_sniff.py --duration 60\n"
            "  sudo python3 crossmem_sniff.py --json-output\n"
            "  sudo python3 crossmem_sniff.py --json-output | jq 'select(.alert)'"
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

    sniffer = CrossMemSniffer(args)
    sniffer.run()


if __name__ == "__main__":
    main()
