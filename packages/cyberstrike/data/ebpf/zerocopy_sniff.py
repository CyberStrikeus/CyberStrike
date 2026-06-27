#!/usr/bin/env python3
"""
zerocopy_sniff.py - Monitor zero-copy data transfers via eBPF.

Attaches to syscalls:sys_enter_splice, sys_enter_tee, and sys_enter_sendfile64
tracepoints to detect fd-to-fd data movement that bypasses userspace. Data
never enters userspace buffers, making it invisible to many profilers.
Requires root privileges.

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

struct zerocopy_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u8  event_type;     // 0=splice, 1=tee, 2=sendfile
    u32 fd_in;
    u32 fd_out;
    u64 len;
    u32 flags;
    u64 offset;
    char comm[TASK_COMM_LEN];
};

BPF_PERF_OUTPUT(zerocopy_events);

TRACEPOINT_PROBE(syscalls, sys_enter_splice) {
    struct zerocopy_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 0;
    event.fd_in = (u32)args->fd_in;
    event.fd_out = (u32)args->fd_out;
    event.len = (u64)args->len;
    event.flags = (u32)args->flags;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));
    zerocopy_events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_tee) {
    struct zerocopy_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 1;
    event.fd_in = (u32)args->fdin;
    event.fd_out = (u32)args->fdout;
    event.len = (u64)args->len;
    event.flags = (u32)args->flags;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));
    zerocopy_events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_sendfile64) {
    struct zerocopy_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 2;
    event.fd_in = (u32)args->in_fd;
    event.fd_out = (u32)args->out_fd;
    event.len = (u64)args->count;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));
    zerocopy_events.perf_submit(args, &event, sizeof(event));
    return 0;
}
"""


class ZeroCopyEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("event_type", ctypes.c_uint8),
        ("fd_in", ctypes.c_uint32),
        ("fd_out", ctypes.c_uint32),
        ("len", ctypes.c_uint64),
        ("flags", ctypes.c_uint32),
        ("offset", ctypes.c_uint64),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
    ]


class ZeroCopySniffer:
    EVENT_TYPES = {0: "splice", 1: "tee", 2: "sendfile"}
    SPLICE_F_MOVE = 1
    SPLICE_F_NONBLOCK = 2
    SPLICE_F_MORE = 4

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.alert_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None
        self.transfer_tracker = {}  # pid -> {total_bytes, count}

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: zerocopy_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def _is_socket_fd(self, pid, fd):
        """Check if fd is a socket."""
        try:
            link = os.readlink(f"/proc/{pid}/fd/{fd}")
            return link.startswith("socket:")
        except (FileNotFoundError, PermissionError):
            return False

    def _get_fd_info(self, pid, fd):
        """Get fd type info."""
        try:
            link = os.readlink(f"/proc/{pid}/fd/{fd}")
            if link.startswith("socket:"):
                return "socket"
            elif link.startswith("pipe:"):
                return "pipe"
            elif link.startswith("/"):
                return f"file:{link}"
            return link
        except (FileNotFoundError, PermissionError):
            return "unknown"

    def print_banner(self):
        print("=" * 70)
        print("  zerocopy_sniff.py - Zero-Copy Data Transfer Monitor (eBPF)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Hooks:       splice + tee + sendfile64")
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
        event = ctypes.cast(data, ctypes.POINTER(ZeroCopyEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        pid = event.pid
        event_name = self.EVENT_TYPES.get(event.event_type, "unknown")

        # Track transfer volumes
        if pid not in self.transfer_tracker:
            self.transfer_tracker[pid] = {"total_bytes": 0, "count": 0}
        self.transfer_tracker[pid]["total_bytes"] += event.len
        self.transfer_tracker[pid]["count"] += 1

        alert = None
        severity = "info"

        # Detect data exfiltration: file → socket via zero-copy
        fd_in_type = self._get_fd_info(pid, event.fd_in)
        fd_out_type = self._get_fd_info(pid, event.fd_out)

        if fd_in_type.startswith("file:") and fd_out_type == "socket":
            alert = "FILE_TO_SOCKET_ZEROCOPY"
            severity = "warning"
            self.alert_count += 1
        elif event.len > 100 * 1024 * 1024:  # > 100MB single transfer
            alert = "LARGE_ZEROCOPY_TRANSFER"
            severity = "warning"
            self.alert_count += 1

        if self.args.json_output:
            record = {
                "timestamp": timestamp, "pid": pid, "uid": event.uid,
                "comm": comm, "event_type": event_name,
                "fd_in": event.fd_in, "fd_out": event.fd_out,
                "fd_in_type": fd_in_type, "fd_out_type": fd_out_type,
                "len": event.len, "flags": event.flags, "severity": severity,
            }
            if alert:
                record["alert"] = alert
            print(json.dumps(record), flush=True)
        else:
            alert_str = f" !!! {alert} !!!" if alert else ""
            print(
                f"[{timestamp}] PID={pid:<8} UID={event.uid:<6} "
                f"COMM={comm:<16} TYPE={event_name:<10} "
                f"IN={event.fd_in}({fd_in_type}) OUT={event.fd_out}({fd_out_type}) "
                f"LEN={event.len}{alert_str}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.print_banner()
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF
        self.bpf = BPF(text=BPF_PROGRAM)
        self.bpf["zerocopy_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing zero-copy transfers... Hit Ctrl+C to stop.\n")
        if not self.args.json_output:
            print(f"{'TIMESTAMP':<28} {'PID':<12} {'UID':<10} {'COMM':<20} {'TYPE':<12} {'INFO'}")
            print("-" * 130)

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
        print(f"\n--- zerocopy_sniff summary ---")
        print(f"Captured {self.event_count} event(s), Alerts: {self.alert_count}")
        for pid, info in self.transfer_tracker.items():
            print(f"  PID {pid}: {info['count']} transfers, {info['total_bytes']} bytes total")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor zero-copy data transfers (splice/tee/sendfile) via eBPF.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n  sudo python3 zerocopy_sniff.py --duration 60\n  sudo python3 zerocopy_sniff.py --json-output",
    )
    parser.add_argument("--json-output", action="store_true", default=False)
    parser.add_argument("--duration", type=int, default=None, metavar="SECONDS")
    args = parser.parse_args()
    ZeroCopySniffer(args).run()


if __name__ == "__main__":
    main()
