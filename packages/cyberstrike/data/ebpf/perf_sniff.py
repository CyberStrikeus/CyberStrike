#!/usr/bin/env python3
"""
perf_sniff.py - Monitor perf_event_open syscall via eBPF.

Attaches to syscalls:sys_enter_perf_event_open tracepoint to detect
side-channel attacks that abuse hardware performance counters (cache misses,
branch mispredictions, etc.) to leak information. Requires root privileges.

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

struct perf_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u32 type;           // PERF_TYPE_HARDWARE=0, SOFTWARE=1, HW_CACHE=3, RAW=4
    u64 config;         // event config (PERF_COUNT_HW_CACHE_MISSES, etc.)
    u32 target_pid;     // pid to monitor (-1 = all)
    u32 cpu;            // cpu to monitor (-1 = all)
    u32 group_fd;
    u64 flags;          // perf_event flags
    u64 sample_period;
    char comm[TASK_COMM_LEN];
};

BPF_PERF_OUTPUT(perf_events);

TRACEPOINT_PROBE(syscalls, sys_enter_perf_event_open) {
    struct perf_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.target_pid = (u32)args->pid;
    event.cpu = (u32)args->cpu;
    event.group_fd = (u32)args->group_fd;
    event.flags = (u64)args->flags;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    // Read perf_event_attr fields from userspace
    // type is at offset 0, size at 4, config at 8
    bpf_probe_read_user(&event.type, sizeof(event.type), (void *)args->attr_uptr);
    bpf_probe_read_user(&event.config, sizeof(event.config), (void *)(args->attr_uptr + 8));
    bpf_probe_read_user(&event.sample_period, sizeof(event.sample_period), (void *)(args->attr_uptr + 16));

    perf_events.perf_submit(args, &event, sizeof(event));
    return 0;
}
"""


class PerfEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("type", ctypes.c_uint32),
        ("config", ctypes.c_uint64),
        ("target_pid", ctypes.c_uint32),
        ("cpu", ctypes.c_uint32),
        ("group_fd", ctypes.c_uint32),
        ("flags", ctypes.c_uint64),
        ("sample_period", ctypes.c_uint64),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
    ]


class PerfSniffer:
    PERF_TYPES = {
        0: "HARDWARE", 1: "SOFTWARE", 2: "TRACEPOINT",
        3: "HW_CACHE", 4: "RAW", 5: "BREAKPOINT",
    }

    HW_EVENTS = {
        0: "CPU_CYCLES", 1: "INSTRUCTIONS", 2: "CACHE_REFERENCES",
        3: "CACHE_MISSES", 4: "BRANCH_INSTRUCTIONS", 5: "BRANCH_MISSES",
        6: "BUS_CYCLES", 7: "STALLED_CYCLES_FRONTEND",
        8: "STALLED_CYCLES_BACKEND", 9: "REF_CPU_CYCLES",
    }

    SW_EVENTS = {
        0: "CPU_CLOCK", 1: "TASK_CLOCK", 2: "PAGE_FAULTS",
        3: "CONTEXT_SWITCHES", 4: "CPU_MIGRATIONS", 5: "PAGE_FAULTS_MIN",
        6: "PAGE_FAULTS_MAJ", 7: "ALIGNMENT_FAULTS", 8: "EMULATION_FAULTS",
        9: "DUMMY", 10: "BPF_OUTPUT", 11: "CGROUP_SWITCHES",
    }

    # Side-channel relevant events
    SIDE_CHANNEL_EVENTS = {
        (0, 3): "CACHE_MISSES",       # Spectre/Meltdown indicator
        (0, 5): "BRANCH_MISSES",      # Spectre variant 2
        (0, 2): "CACHE_REFERENCES",   # Cache-based side channels
        (3, None): "HW_CACHE",        # All cache events
    }

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.alert_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None
        self.pid_event_counts = {}  # pid -> count of perf_event_open calls

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: perf_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  perf_sniff.py - Performance Counter Side-Channel Monitor (eBPF)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Hooks:       perf_event_open")
        print(f"  JSON output: {self.args.json_output}")
        if self.args.duration:
            print(f"  Duration:    {self.args.duration}s")
        else:
            print("  Duration:    unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def _get_event_name(self, perf_type, config):
        if perf_type == 0:
            return self.HW_EVENTS.get(config, f"HW_EVENT({config})")
        if perf_type == 1:
            return self.SW_EVENTS.get(config, f"SW_EVENT({config})")
        if perf_type == 3:
            return f"HW_CACHE({config})"
        if perf_type == 4:
            return f"RAW({hex(config)})"
        if perf_type == 2:
            return f"TRACEPOINT({config})"
        return f"EVENT({perf_type},{config})"

    def _is_side_channel(self, perf_type, config):
        if (perf_type, config) in self.SIDE_CHANNEL_EVENTS:
            return True
        if (perf_type, None) in self.SIDE_CHANNEL_EVENTS:
            return True
        return False

    def handle_event(self, cpu, data, size):
        event = ctypes.cast(data, ctypes.POINTER(PerfEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        pid = event.pid
        perf_type = event.type
        config = event.config

        type_name = self.PERF_TYPES.get(perf_type, f"TYPE({perf_type})")
        event_name = self._get_event_name(perf_type, config)

        # Track per-PID frequency
        self.pid_event_counts[pid] = self.pid_event_counts.get(pid, 0) + 1

        alert = None
        severity = "info"

        if self._is_side_channel(perf_type, config):
            alert = "SIDE_CHANNEL_COUNTER"
            severity = "warning"
            self.alert_count += 1

        # High-frequency perf_event_open from same PID = likely side-channel attack
        if self.pid_event_counts[pid] > 10:
            alert = "HIGH_FREQ_PERF_EVENTS"
            severity = "critical"
            self.alert_count += 1

        # Monitoring another process's perf events
        target_pid = event.target_pid
        if target_pid != 0xFFFFFFFF and target_pid != pid:
            alert = "CROSS_PROCESS_PERF_MONITORING"
            severity = "critical"
            self.alert_count += 1

        if alert and not self.args.json_output:
            print(
                f"\n{'!'*70}\n"
                f"  !!! {alert} !!!\n"
                f"  PID={pid} COMM={comm}\n"
                f"  TYPE={type_name} EVENT={event_name}\n"
                f"  TARGET_PID={target_pid} CPU={event.cpu}\n"
                f"{'!'*70}\n",
                flush=True,
            )

        if self.args.json_output:
            record = {
                "timestamp": timestamp, "pid": pid, "uid": event.uid,
                "comm": comm, "perf_type": type_name, "event": event_name,
                "config": event.config, "target_pid": target_pid,
                "cpu": event.cpu, "flags": hex(event.flags),
                "sample_period": event.sample_period, "severity": severity,
            }
            if alert:
                record["alert"] = alert
            print(json.dumps(record), flush=True)
        elif not alert:
            print(
                f"[{timestamp}] PID={pid:<8} UID={event.uid:<6} "
                f"COMM={comm:<16} TYPE={type_name:<12} "
                f"EVENT={event_name:<24} TARGET={target_pid} CPU={event.cpu}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.print_banner()
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF
        self.bpf = BPF(text=BPF_PROGRAM)
        self.bpf["perf_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing perf_event_open operations... Hit Ctrl+C to stop.\n")
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
        print(f"\n--- perf_sniff summary ---")
        print(f"Captured {self.event_count} event(s), Alerts: {self.alert_count}")
        if self.pid_event_counts:
            top_pids = sorted(self.pid_event_counts.items(), key=lambda x: x[1], reverse=True)[:5]
            print(f"Top perf_event_open PIDs: {top_pids}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor perf_event_open for side-channel attacks via eBPF.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n  sudo python3 perf_sniff.py --duration 60\n  sudo python3 perf_sniff.py --json-output",
    )
    parser.add_argument("--json-output", action="store_true", default=False)
    parser.add_argument("--duration", type=int, default=None, metavar="SECONDS")
    args = parser.parse_args()
    PerfSniffer(args).run()


if __name__ == "__main__":
    main()
