#!/usr/bin/env python3
"""
memfd_exec.py - Detect fileless execution via memfd_create + execveat.

Correlates memfd_create → write → execveat(fd, "", AT_EMPTY_PATH) chains
to detect diskless payload delivery. The payload never touches disk — it
exists only in memory via memfd. Requires root privileges.

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
MAX_NAME_LEN = 256

BPF_PROGRAM = r"""
#include <uapi/linux/ptrace.h>
#include <linux/sched.h>

#define MAX_NAME_LEN 256
#define AT_EMPTY_PATH 0x1000

struct memfd_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u8  event_type;     // 0=memfd_create_entry, 1=memfd_create_return, 2=execveat
    u32 fd;
    u32 flags;
    u64 data_len;
    u32 dirfd;
    char comm[TASK_COMM_LEN];
    char name[MAX_NAME_LEN];
};

BPF_PERF_OUTPUT(memfd_events);

// Track pending memfd_create: tid -> name
BPF_HASH(pending_memfd, u32, char[MAX_NAME_LEN]);

// Track returned memfd fds: pid -> fd
BPF_HASH(memfd_fds, u64, u32);

TRACEPOINT_PROBE(syscalls, sys_enter_memfd_create) {
    u32 tid = bpf_get_current_pid_tgid() & 0xFFFFFFFF;

    struct memfd_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 0;
    event.flags = args->flags;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));
    bpf_probe_read_user_str(&event.name, sizeof(event.name), (const char *)args->uname);

    // Store name for return probe correlation
    char name_buf[MAX_NAME_LEN] = {};
    bpf_probe_read_user_str(name_buf, sizeof(name_buf), (const char *)args->uname);
    pending_memfd.update(&tid, &name_buf);

    memfd_events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_exit_memfd_create) {
    u32 tid = bpf_get_current_pid_tgid() & 0xFFFFFFFF;
    u32 pid = bpf_get_current_pid_tgid() >> 32;
    long ret = args->ret;

    if (ret < 0) {
        pending_memfd.delete(&tid);
        return 0;
    }

    u64 key = ((u64)pid << 32) | (u32)ret;
    u32 val = 1;
    memfd_fds.update(&key, &val);

    struct memfd_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = pid;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 1;
    event.fd = (u32)ret;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    char (*name)[MAX_NAME_LEN] = pending_memfd.lookup(&tid);
    if (name) {
        __builtin_memcpy(&event.name, name, MAX_NAME_LEN);
        pending_memfd.delete(&tid);
    }

    memfd_events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_execveat) {
    struct memfd_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 2;
    event.fd = (u32)args->fd;
    event.dirfd = (u32)args->fd;
    event.flags = args->flags;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));
    bpf_probe_read_user_str(&event.name, sizeof(event.name), (const char *)args->filename);

    memfd_events.perf_submit(args, &event, sizeof(event));
    return 0;
}
"""


class MemfdEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("event_type", ctypes.c_uint8),
        ("fd", ctypes.c_uint32),
        ("flags", ctypes.c_uint32),
        ("data_len", ctypes.c_uint64),
        ("dirfd", ctypes.c_uint32),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
        ("name", ctypes.c_char * MAX_NAME_LEN),
    ]


class MemfdExecDetector:
    EVENT_TYPES = {0: "memfd_create", 1: "memfd_fd_created", 2: "execveat"}
    AT_EMPTY_PATH = 0x1000
    MFD_CLOEXEC = 0x0001
    MFD_ALLOW_SEALING = 0x0002

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.alert_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None
        self.pending_memfds = {}  # pid -> {fd, name, create_time}

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: memfd_exec.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  memfd_exec.py - Fileless Execution Detector (eBPF)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Hooks:       memfd_create (entry+exit) + execveat (entry)")
        print(f"  JSON output: {self.args.json_output}")
        if self.args.duration:
            print(f"  Duration:    {self.args.duration}s")
        else:
            print("  Duration:    unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def _format_memfd_flags(self, flags):
        parts = []
        if flags & self.MFD_CLOEXEC:
            parts.append("MFD_CLOEXEC")
        if flags & self.MFD_ALLOW_SEALING:
            parts.append("MFD_ALLOW_SEALING")
        return "|".join(parts) if parts else hex(flags)

    def handle_event(self, cpu, data, size):
        event = ctypes.cast(data, ctypes.POINTER(MemfdEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        name = event.name.decode("utf-8", errors="replace").rstrip("\x00")
        pid = event.pid
        event_type = event.event_type
        event_name = self.EVENT_TYPES.get(event_type, f"unknown({event_type})")

        alert = None

        if event_type == 1:  # memfd_create return — fd obtained
            self.pending_memfds[pid] = {
                "fd": event.fd,
                "name": name,
                "create_time": event.timestamp_ns,
            }

        elif event_type == 2:  # execveat
            flags = event.flags
            is_at_empty_path = bool(flags & self.AT_EMPTY_PATH)
            pathname_empty = (name == "" or name == "\x00" or not name)

            if is_at_empty_path and pid in self.pending_memfds:
                memfd_info = self.pending_memfds[pid]
                if event.fd == memfd_info["fd"]:
                    elapsed_ns = event.timestamp_ns - memfd_info["create_time"]
                    elapsed_ms = elapsed_ns / 1e6
                    self.alert_count += 1
                    alert = "FILELESS_EXECUTION"

                    if not self.args.json_output:
                        print(
                            f"\n{'!'*70}\n"
                            f"  !!! FILELESS EXECUTION DETECTED !!!\n"
                            f"  PID={pid} executed memfd '{memfd_info['name']}' via\n"
                            f"  execveat(fd={event.fd}, \"\", AT_EMPTY_PATH)\n"
                            f"  Time from memfd_create to exec: {elapsed_ms:.1f}ms\n"
                            f"{'!'*70}\n",
                            flush=True,
                        )
                    del self.pending_memfds[pid]

            elif is_at_empty_path or pathname_empty:
                alert = "SUSPICIOUS_EXECVEAT"
                self.alert_count += 1

        if self.args.json_output:
            record = {
                "timestamp": timestamp,
                "pid": pid,
                "uid": event.uid,
                "comm": comm,
                "event_type": event_name,
                "fd": event.fd,
                "flags": event.flags,
                "name": name,
            }
            if alert:
                record["alert"] = alert
                if alert == "FILELESS_EXECUTION" and pid in self.pending_memfds:
                    memfd_info = self.pending_memfds.get(pid, {})
                    record["memfd_name"] = memfd_info.get("name", "")
            print(json.dumps(record), flush=True)
        else:
            flags_str = ""
            if event_type == 0:
                flags_str = f" flags={self._format_memfd_flags(event.flags)}"
            elif event_type == 2:
                at_empty = " AT_EMPTY_PATH" if (event.flags & self.AT_EMPTY_PATH) else ""
                flags_str = f" fd={event.fd}{at_empty}"

            alert_str = f" !!! ALERT: {alert} !!!" if alert else ""
            print(
                f"[{timestamp}] PID={pid:<8} UID={event.uid:<6} "
                f"COMM={comm:<16} TYPE={event_name:<20} "
                f"NAME={name}{flags_str}{alert_str}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF

        self.bpf = BPF(text=BPF_PROGRAM)

        self.bpf["memfd_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing memfd_create + execveat... Hit Ctrl+C to stop.\n")
        if not self.args.json_output:
            print(
                f"{'TIMESTAMP':<28} {'PID':<12} {'UID':<10} "
                f"{'COMM':<20} {'TYPE':<24} {'INFO'}"
            )
            print("-" * 120)

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
        print(f"\n--- memfd_exec summary ---")
        print(f"Captured {self.event_count} event(s)")
        print(f"Fileless execution alerts: {self.alert_count}")
        pending = len(self.pending_memfds)
        if pending:
            print(f"Uncorrelated memfd_create calls: {pending}")
        if self.start_time:
            elapsed = time.monotonic() - self.start_time
            print(f"Duration: {elapsed:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Detect fileless execution via memfd_create + execveat correlation using eBPF.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 memfd_exec.py --duration 60\n"
            "  sudo python3 memfd_exec.py --json-output\n"
            "  sudo python3 memfd_exec.py --json-output --duration 300 | tee memfd.log"
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

    detector = MemfdExecDetector(args)
    detector.run()


if __name__ == "__main__":
    main()
