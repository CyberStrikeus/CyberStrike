#!/usr/bin/env python3
"""
vdso_sniff.py - Monitor VDSO usage and timing side-channels via eBPF.

VDSO (Virtual Dynamic Shared Object) resolves certain syscalls
(clock_gettime, gettimeofday) in userspace without entering the kernel,
making them invisible to eBPF syscall hooks. This tool monitors the
kernel-side fallback paths and detects VDSO page tampering via mprotect
on VDSO address ranges. Requires root privileges.

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

struct vdso_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u8  event_type;     // 0=clock_gettime, 1=gettimeofday, 2=mprotect_vdso
    u32 clock_id;
    u64 addr;
    u64 length;
    u32 prot;
    u64 call_count;
    char comm[TASK_COMM_LEN];
};

BPF_PERF_OUTPUT(vdso_events);

// Track per-PID syscall call frequency for anomaly detection
BPF_HASH(clock_counts, u32, u64);
BPF_HASH(tod_counts, u32, u64);

TRACEPOINT_PROBE(syscalls, sys_enter_clock_gettime) {
    u32 pid = bpf_get_current_pid_tgid() >> 32;

    u64 *count = clock_counts.lookup(&pid);
    u64 new_count = count ? *count + 1 : 1;
    clock_counts.update(&pid, &new_count);

    // Only emit events every 1000 calls to reduce overhead
    if (new_count % 1000 != 0)
        return 0;

    struct vdso_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = pid;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 0;
    event.clock_id = (u32)args->which_clock;
    event.call_count = new_count;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    vdso_events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_gettimeofday) {
    u32 pid = bpf_get_current_pid_tgid() >> 32;

    u64 *count = tod_counts.lookup(&pid);
    u64 new_count = count ? *count + 1 : 1;
    tod_counts.update(&pid, &new_count);

    if (new_count % 1000 != 0)
        return 0;

    struct vdso_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = pid;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 1;
    event.call_count = new_count;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    vdso_events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_mprotect) {
    u64 addr = (u64)args->start;

    // VDSO is typically mapped at high addresses (near stack)
    // Common range: 0x7fff_xxxx_x000 on x86_64
    // We check for mprotect on likely VDSO pages
    if (addr < 0x7ff000000000)
        return 0;

    struct vdso_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 2;
    event.addr = addr;
    event.length = (u64)args->len;
    event.prot = (u32)args->prot;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    vdso_events.perf_submit(args, &event, sizeof(event));
    return 0;
}
"""


class VdsoEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("event_type", ctypes.c_uint8),
        ("clock_id", ctypes.c_uint32),
        ("addr", ctypes.c_uint64),
        ("length", ctypes.c_uint64),
        ("prot", ctypes.c_uint32),
        ("call_count", ctypes.c_uint64),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
    ]


class VdsoSniffer:
    EVENT_TYPES = {0: "clock_gettime", 1: "gettimeofday", 2: "mprotect_high_addr"}
    CLOCK_IDS = {
        0: "REALTIME", 1: "MONOTONIC", 2: "PROCESS_CPUTIME",
        3: "THREAD_CPUTIME", 4: "MONOTONIC_RAW", 5: "REALTIME_COARSE",
        6: "MONOTONIC_COARSE", 7: "BOOTTIME",
    }
    HIGH_FREQ_THRESHOLD = 10000  # calls per sampling window

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.alert_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: vdso_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def _get_vdso_addr(self, pid):
        """Get VDSO mapping address from /proc/pid/maps."""
        try:
            with open(f"/proc/{pid}/maps", "r") as f:
                for line in f:
                    if "[vdso]" in line:
                        return line.split("-")[0]
        except (FileNotFoundError, PermissionError):
            pass
        return None

    def print_banner(self):
        print("=" * 70)
        print("  vdso_sniff.py - VDSO / Timing Side-Channel Monitor (eBPF)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Hooks:       clock_gettime + gettimeofday + mprotect (high addr)")
        print(f"  Sampling:    emit every 1000 calls (kernel-side)")
        print(f"  JSON output: {self.args.json_output}")
        if self.args.duration:
            print(f"  Duration:    {self.args.duration}s")
        else:
            print("  Duration:    unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def handle_event(self, cpu, data, size):
        event = ctypes.cast(data, ctypes.POINTER(VdsoEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        pid = event.pid
        event_type = event.event_type
        event_name = self.EVENT_TYPES.get(event_type, f"unknown({event_type})")

        alert = None
        severity = "info"

        if event_type == 2:  # mprotect on high address (possible VDSO)
            vdso_addr = self._get_vdso_addr(pid)
            target_hex = format(event.addr, "x")
            if vdso_addr and target_hex.startswith(vdso_addr[:8]):
                alert = "VDSO_PAGE_TAMPERING"
                severity = "critical"
                self.alert_count += 1
            else:
                alert = "HIGH_ADDR_MPROTECT"
                severity = "warning"
                self.alert_count += 1

        elif event.call_count >= self.HIGH_FREQ_THRESHOLD:
            alert = "HIGH_FREQ_TIMING"
            severity = "warning"
            self.alert_count += 1

        if self.args.json_output:
            record = {
                "timestamp": timestamp, "pid": pid, "uid": event.uid,
                "comm": comm, "event_type": event_name, "severity": severity,
            }
            if event_type in (0, 1):
                record["call_count"] = event.call_count
                if event_type == 0:
                    record["clock_id"] = self.CLOCK_IDS.get(event.clock_id, str(event.clock_id))
            else:
                record["addr"] = hex(event.addr)
                record["length"] = event.length
                record["prot"] = event.prot
            if alert:
                record["alert"] = alert
            print(json.dumps(record), flush=True)
        else:
            alert_str = f" !!! {alert} !!!" if alert else ""
            if event_type in (0, 1):
                clock_str = f" CLOCK={self.CLOCK_IDS.get(event.clock_id, '?')}" if event_type == 0 else ""
                print(
                    f"[{timestamp}] PID={pid:<8} COMM={comm:<16} "
                    f"TYPE={event_name:<16} COUNT={event.call_count}{clock_str}{alert_str}",
                    flush=True,
                )
            else:
                print(
                    f"[{timestamp}] PID={pid:<8} COMM={comm:<16} "
                    f"TYPE={event_name:<20} ADDR={hex(event.addr)} "
                    f"LEN={event.length} PROT={event.prot}{alert_str}",
                    flush=True,
                )

    def run(self):
        self.check_root()
        self.print_banner()
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF
        self.bpf = BPF(text=BPF_PROGRAM)
        self.bpf["vdso_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing VDSO/timing operations... Hit Ctrl+C to stop.\n")
        self.start_time = time.monotonic()
        while self.running:
            try:
                self.bpf.perf_buffer_poll(timeout=100)
            except KeyboardInterrupt:
                self.running = False
                break
            if self.args.duration and time.monotonic() - self.start_time >= self.args.duration:
                break
        self.cleanup()

    def cleanup(self):
        print(f"\n--- vdso_sniff summary ---")
        print(f"Captured {self.event_count} event(s), Alerts: {self.alert_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor VDSO usage and timing side-channels via eBPF.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n  sudo python3 vdso_sniff.py --duration 60\n  sudo python3 vdso_sniff.py --json-output",
    )
    parser.add_argument("--json-output", action="store_true", default=False)
    parser.add_argument("--duration", type=int, default=None, metavar="SECONDS")
    args = parser.parse_args()
    VdsoSniffer(args).run()


if __name__ == "__main__":
    main()
