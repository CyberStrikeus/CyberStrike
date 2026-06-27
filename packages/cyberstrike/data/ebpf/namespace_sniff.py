#!/usr/bin/env python3
"""
namespace_sniff.py - Monitor namespace changes via eBPF.

Attaches to syscalls:sys_enter_setns and sys_enter_unshare tracepoints
to detect container escapes and namespace pivoting. If the harness only
monitors one namespace, an attacker switching namespaces becomes invisible.
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

struct ns_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u8  event_type;     // 0=setns, 1=unshare
    u32 fd;
    u32 nstype;
    u32 flags;
    u32 ppid;
    char comm[TASK_COMM_LEN];
};

BPF_PERF_OUTPUT(ns_events);

TRACEPOINT_PROBE(syscalls, sys_enter_setns) {
    struct ns_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 0;
    event.fd = (u32)args->fd;
    event.nstype = (u32)args->flags;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));
    struct task_struct *task = (struct task_struct *)bpf_get_current_task();
    event.ppid = task->real_parent->tgid;
    ns_events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_unshare) {
    struct ns_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 1;
    event.flags = (u32)args->unshare_flags;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));
    struct task_struct *task = (struct task_struct *)bpf_get_current_task();
    event.ppid = task->real_parent->tgid;
    ns_events.perf_submit(args, &event, sizeof(event));
    return 0;
}
"""


class NsEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("event_type", ctypes.c_uint8),
        ("fd", ctypes.c_uint32),
        ("nstype", ctypes.c_uint32),
        ("flags", ctypes.c_uint32),
        ("ppid", ctypes.c_uint32),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
    ]


class NamespaceSniffer:
    EVENT_TYPES = {0: "setns", 1: "unshare"}
    CLONE_NEWNS = 0x00020000
    CLONE_NEWCGROUP = 0x02000000
    CLONE_NEWUTS = 0x04000000
    CLONE_NEWIPC = 0x08000000
    CLONE_NEWUSER = 0x10000000
    CLONE_NEWPID = 0x20000000
    CLONE_NEWNET = 0x40000000
    CLONE_NEWTIME = 0x00000080

    NS_FLAGS = {
        0x00020000: "MNT", 0x02000000: "CGROUP", 0x04000000: "UTS",
        0x08000000: "IPC", 0x10000000: "USER", 0x20000000: "PID",
        0x40000000: "NET", 0x00000080: "TIME",
    }

    # Container escape indicators
    ESCAPE_FLAGS = {0x00020000, 0x20000000, 0x40000000, 0x10000000}  # MNT, PID, NET, USER

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.alert_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: namespace_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def _format_ns_flags(self, flags):
        parts = []
        for flag, name in self.NS_FLAGS.items():
            if flags & flag:
                parts.append(name)
        return "|".join(parts) if parts else hex(flags)

    def _get_ns_fd_info(self, pid, fd):
        """Resolve namespace fd target."""
        try:
            link = os.readlink(f"/proc/{pid}/fd/{fd}")
            return link
        except (FileNotFoundError, PermissionError):
            return "unknown"

    def print_banner(self):
        print("=" * 70)
        print("  namespace_sniff.py - Namespace Change Monitor (eBPF)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Hooks:       setns + unshare")
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
        event = ctypes.cast(data, ctypes.POINTER(NsEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        pid = event.pid
        event_name = self.EVENT_TYPES.get(event.event_type, "unknown")

        alert = None
        severity = "info"

        if event.event_type == 0:  # setns
            ns_info = self._get_ns_fd_info(pid, event.fd)
            ns_flags = self._format_ns_flags(event.nstype)

            # setns to another PID/MNT/NET namespace = container escape indicator
            if event.nstype & (self.CLONE_NEWPID | self.CLONE_NEWNS | self.CLONE_NEWNET):
                alert = "NAMESPACE_PIVOT"
                severity = "critical"
                self.alert_count += 1
            elif event.nstype == 0:  # nstype=0 means join whatever ns the fd points to
                alert = "NAMESPACE_JOIN_ANY"
                severity = "warning"
                self.alert_count += 1

        elif event.event_type == 1:  # unshare
            ns_flags = self._format_ns_flags(event.flags)
            escape_ns = event.flags & (self.CLONE_NEWPID | self.CLONE_NEWNS | self.CLONE_NEWNET | self.CLONE_NEWUSER)
            if escape_ns:
                alert = "NAMESPACE_ESCAPE"
                severity = "critical"
                self.alert_count += 1

        if alert and not self.args.json_output:
            print(
                f"\n{'!'*70}\n"
                f"  !!! {alert} !!!\n"
                f"  PID={pid} PPID={event.ppid} COMM={comm}\n"
                f"  TYPE={event_name} NS={self._format_ns_flags(event.nstype if event.event_type == 0 else event.flags)}\n"
                f"{'!'*70}\n",
                flush=True,
            )

        if self.args.json_output:
            record = {
                "timestamp": timestamp, "pid": pid, "ppid": event.ppid,
                "uid": event.uid, "comm": comm, "event_type": event_name,
                "severity": severity,
            }
            if event.event_type == 0:
                record["fd"] = event.fd
                record["nstype"] = self._format_ns_flags(event.nstype)
                record["ns_target"] = self._get_ns_fd_info(pid, event.fd)
            else:
                record["unshare_flags"] = self._format_ns_flags(event.flags)
            if alert:
                record["alert"] = alert
            print(json.dumps(record), flush=True)
        elif not alert:
            flags_str = self._format_ns_flags(event.nstype if event.event_type == 0 else event.flags)
            print(
                f"[{timestamp}] PID={pid:<8} PPID={event.ppid:<8} "
                f"COMM={comm:<16} TYPE={event_name:<8} NS={flags_str}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.print_banner()
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF
        self.bpf = BPF(text=BPF_PROGRAM)
        self.bpf["ns_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing namespace operations... Hit Ctrl+C to stop.\n")
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
        print(f"\n--- namespace_sniff summary ---")
        print(f"Captured {self.event_count} event(s), Alerts: {self.alert_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor namespace changes (setns/unshare) for container escape detection via eBPF.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n  sudo python3 namespace_sniff.py --duration 60\n  sudo python3 namespace_sniff.py --json-output",
    )
    parser.add_argument("--json-output", action="store_true", default=False)
    parser.add_argument("--duration", type=int, default=None, metavar="SECONDS")
    args = parser.parse_args()
    NamespaceSniffer(args).run()


if __name__ == "__main__":
    main()
