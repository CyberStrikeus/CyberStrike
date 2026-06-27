#!/usr/bin/env python3
"""
mmap_sniff.py - Monitor shared memory creation and IPC via eBPF.

Attaches to syscalls:sys_enter_mmap, sys_enter_shmget, and sys_enter_shmat
tracepoints to detect shared memory regions used for covert inter-process
communication. After the initial mmap/shmat, data flows in memory without
generating syscalls. Requires root privileges.

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

struct mmap_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u8  event_type;     // 0=mmap, 1=shmget, 2=shmat
    u64 addr;
    u64 length;
    u32 prot;
    u32 flags;
    u32 fd;
    u64 offset;
    u32 shmid;
    char comm[TASK_COMM_LEN];
};

BPF_PERF_OUTPUT(mmap_events);

TRACEPOINT_PROBE(syscalls, sys_enter_mmap) {
    u32 flags = (u32)args->flags;

    // Only capture MAP_SHARED mappings (IPC-relevant)
    // MAP_SHARED = 0x01
    if (!(flags & 0x01))
        return 0;

    struct mmap_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 0;
    event.addr = (u64)args->addr;
    event.length = (u64)args->len;
    event.prot = (u32)args->prot;
    event.flags = flags;
    event.fd = (u32)args->fd;
    event.offset = (u64)args->off;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    mmap_events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_shmget) {
    struct mmap_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 1;
    event.length = (u64)args->size;
    event.flags = (u32)args->shmflg;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    mmap_events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_shmat) {
    struct mmap_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 2;
    event.shmid = (u32)args->shmid;
    event.addr = (u64)args->shmaddr;
    event.flags = (u32)args->shmflg;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    mmap_events.perf_submit(args, &event, sizeof(event));
    return 0;
}
"""


class MmapEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("event_type", ctypes.c_uint8),
        ("addr", ctypes.c_uint64),
        ("length", ctypes.c_uint64),
        ("prot", ctypes.c_uint32),
        ("flags", ctypes.c_uint32),
        ("fd", ctypes.c_uint32),
        ("offset", ctypes.c_uint64),
        ("shmid", ctypes.c_uint32),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
    ]


class MmapSniffer:
    EVENT_TYPES = {0: "mmap_shared", 1: "shmget", 2: "shmat"}

    PROT_READ = 0x1
    PROT_WRITE = 0x2
    PROT_EXEC = 0x4
    MAP_SHARED = 0x01
    MAP_ANONYMOUS = 0x20
    MAP_HUGETLB = 0x40000

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.alert_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None
        self.shared_regions = {}  # pid -> [{addr, length, prot, flags}]

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: mmap_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  mmap_sniff.py - Shared Memory / IPC Monitor (eBPF)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Hooks:       mmap (MAP_SHARED) + shmget + shmat")
        print(f"  JSON output: {self.args.json_output}")
        if self.args.duration:
            print(f"  Duration:    {self.args.duration}s")
        else:
            print("  Duration:    unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def _format_prot(self, prot):
        parts = []
        if prot & self.PROT_READ: parts.append("R")
        if prot & self.PROT_WRITE: parts.append("W")
        if prot & self.PROT_EXEC: parts.append("X")
        return "".join(parts) if parts else "NONE"

    def _format_flags(self, flags):
        parts = []
        if flags & self.MAP_SHARED: parts.append("SHARED")
        if flags & self.MAP_ANONYMOUS: parts.append("ANON")
        if flags & self.MAP_HUGETLB: parts.append("HUGETLB")
        return "|".join(parts) if parts else hex(flags)

    def handle_event(self, cpu, data, size):
        event = ctypes.cast(data, ctypes.POINTER(MmapEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        pid = event.pid
        event_type = event.event_type
        event_name = self.EVENT_TYPES.get(event_type, f"unknown({event_type})")

        alert = None
        severity = "info"

        if event_type == 0:  # mmap MAP_SHARED
            is_anon = bool(event.flags & self.MAP_ANONYMOUS)
            is_rwx = (event.prot & self.PROT_READ) and (event.prot & self.PROT_WRITE) and (event.prot & self.PROT_EXEC)
            is_rw = (event.prot & self.PROT_READ) and (event.prot & self.PROT_WRITE)

            if is_anon and is_rw:
                alert = "SHARED_ANONYMOUS_RW"
                severity = "warning"
                self.alert_count += 1
            if is_rwx:
                alert = "SHARED_RWX_MAPPING"
                severity = "critical"
                self.alert_count += 1

            if pid not in self.shared_regions:
                self.shared_regions[pid] = []
            self.shared_regions[pid].append({
                "addr": event.addr, "length": event.length,
                "prot": event.prot, "flags": event.flags,
            })

        elif event_type == 1:  # shmget
            if event.length > 10 * 1024 * 1024:  # > 10MB
                alert = "LARGE_SHM_SEGMENT"
                severity = "warning"
                self.alert_count += 1

        elif event_type == 2:  # shmat
            alert = "SHM_ATTACH"
            severity = "info"

        if self.args.json_output:
            record = {
                "timestamp": timestamp,
                "pid": pid,
                "uid": event.uid,
                "comm": comm,
                "event_type": event_name,
                "addr": hex(event.addr),
                "length": event.length,
                "prot": self._format_prot(event.prot),
                "flags": self._format_flags(event.flags),
                "severity": severity,
            }
            if event_type == 0:
                record["fd"] = event.fd
                record["offset"] = event.offset
            elif event_type == 2:
                record["shmid"] = event.shmid
            if alert:
                record["alert"] = alert
            print(json.dumps(record), flush=True)
        else:
            alert_str = f" !!! {alert} !!!" if alert else ""
            extra = ""
            if event_type == 0:
                extra = f" PROT={self._format_prot(event.prot)} FLAGS={self._format_flags(event.flags)} FD={event.fd}"
            elif event_type == 1:
                extra = f" SIZE={event.length} FLAGS={hex(event.flags)}"
            elif event_type == 2:
                extra = f" SHMID={event.shmid}"
            print(
                f"[{timestamp}] PID={pid:<8} UID={event.uid:<6} "
                f"COMM={comm:<16} TYPE={event_name:<16} "
                f"LEN={event.length}{extra}{alert_str}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF
        self.bpf = BPF(text=BPF_PROGRAM)
        self.bpf["mmap_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing shared memory operations... Hit Ctrl+C to stop.\n")
        if not self.args.json_output:
            print(f"{'TIMESTAMP':<28} {'PID':<12} {'UID':<10} {'COMM':<20} {'TYPE':<20} {'INFO'}")
            print("-" * 130)

        self.start_time = time.monotonic()
        while self.running:
            try:
                self.bpf.perf_buffer_poll(timeout=100)
            except KeyboardInterrupt:
                self.running = False
                break
            if self.args.duration:
                if time.monotonic() - self.start_time >= self.args.duration:
                    break
        self.cleanup()

    def cleanup(self):
        print(f"\n--- mmap_sniff summary ---")
        print(f"Captured {self.event_count} event(s), Alerts: {self.alert_count}")
        print(f"PIDs with shared mappings: {len(self.shared_regions)}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor shared memory creation (mmap MAP_SHARED, shmget, shmat) via eBPF.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n  sudo python3 mmap_sniff.py --duration 60\n  sudo python3 mmap_sniff.py --json-output",
    )
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON (one per line)")
    parser.add_argument("--duration", type=int, default=None, metavar="SECONDS", help="Run duration")
    args = parser.parse_args()
    MmapSniffer(args).run()


if __name__ == "__main__":
    main()
