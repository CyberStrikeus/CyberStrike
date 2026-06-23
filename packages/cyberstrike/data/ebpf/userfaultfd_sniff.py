#!/usr/bin/env python3
"""
userfaultfd_sniff.py - Monitor userfaultfd creation via eBPF.

Attaches to syscalls:sys_enter_userfaultfd and sys_exit_userfaultfd tracepoints
to detect race condition exploit primitives that use userspace page fault
handlers for timing control. Legitimate use is rare (QEMU/KVM live migration).
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

struct uffd_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u32 flags;
    u8  event_type;     // 0=enter, 1=exit
    u32 fd;
    u32 ppid;
    char comm[TASK_COMM_LEN];
};

BPF_PERF_OUTPUT(uffd_events);

// Track pending calls for return correlation
BPF_HASH(pending_uffd, u32, u32);

TRACEPOINT_PROBE(syscalls, sys_enter_userfaultfd) {
    u32 tid = bpf_get_current_pid_tgid() & 0xFFFFFFFF;
    u32 flags = (u32)args->flags;
    pending_uffd.update(&tid, &flags);

    struct uffd_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.flags = flags;
    event.event_type = 0;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    struct task_struct *task = (struct task_struct *)bpf_get_current_task();
    event.ppid = task->real_parent->tgid;

    uffd_events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_exit_userfaultfd) {
    u32 tid = bpf_get_current_pid_tgid() & 0xFFFFFFFF;
    long ret = args->ret;

    u32 *flags_ptr = pending_uffd.lookup(&tid);
    if (!flags_ptr) return 0;

    u32 flags = *flags_ptr;
    pending_uffd.delete(&tid);

    struct uffd_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.flags = flags;
    event.event_type = 1;
    event.fd = (ret >= 0) ? (u32)ret : 0;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    struct task_struct *task = (struct task_struct *)bpf_get_current_task();
    event.ppid = task->real_parent->tgid;

    uffd_events.perf_submit(args, &event, sizeof(event));
    return 0;
}
"""


class UffdEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("flags", ctypes.c_uint32),
        ("event_type", ctypes.c_uint8),
        ("fd", ctypes.c_uint32),
        ("ppid", ctypes.c_uint32),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
    ]


class UserfaultfdSniffer:
    EVENT_TYPES = {0: "userfaultfd_enter", 1: "userfaultfd_return"}

    # Known legitimate userfaultfd users
    KNOWN_LEGIT = {"qemu", "qemu-system", "qemu-kvm", "firecracker", "crosvm"}

    O_CLOEXEC = 0x80000
    O_NONBLOCK = 0x800

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.alert_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None
        self.uffd_pids = {}  # pid -> {fd, flags, create_time, comm}

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: userfaultfd_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def _check_unprivileged_uffd(self):
        """Check if unprivileged userfaultfd is enabled (kernel 5.11+)."""
        try:
            with open("/proc/sys/vm/unprivileged_userfaultfd", "r") as f:
                return f.read().strip() == "1"
        except FileNotFoundError:
            return False

    def print_banner(self):
        unprivileged = self._check_unprivileged_uffd()
        print("=" * 70)
        print("  userfaultfd_sniff.py - Userfaultfd Race Condition Detector (eBPF)")
        print("=" * 70)
        print(f"  PID:                  {os.getpid()}")
        print(f"  Hooks:                userfaultfd (enter+exit)")
        print(f"  Unprivileged uffd:    {'ENABLED (extra risk)' if unprivileged else 'disabled'}")
        print(f"  JSON output:          {self.args.json_output}")
        if self.args.duration:
            print(f"  Duration:             {self.args.duration}s")
        else:
            print("  Duration:             unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print()
        if unprivileged:
            print("WARNING: vm.unprivileged_userfaultfd=1 — non-root users can create userfaultfd")
            print("         This significantly increases kernel exploit risk.\n")

    def signal_handler(self, signum, frame):
        self.running = False

    def _format_flags(self, flags):
        parts = []
        if flags & self.O_CLOEXEC:
            parts.append("O_CLOEXEC")
        if flags & self.O_NONBLOCK:
            parts.append("O_NONBLOCK")
        return "|".join(parts) if parts else hex(flags)

    def handle_event(self, cpu, data, size):
        event = ctypes.cast(data, ctypes.POINTER(UffdEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        pid = event.pid
        event_type = event.event_type
        event_name = self.EVENT_TYPES.get(event_type, f"unknown({event_type})")

        # Determine if this is a known legitimate user
        is_legit = any(comm.startswith(name) for name in self.KNOWN_LEGIT)

        alert = None
        severity = "info"

        if event_type == 0:  # entry
            if not is_legit:
                alert = "USERFAULTFD_CREATED"
                severity = "warning"
                self.alert_count += 1

        elif event_type == 1:  # return with fd
            self.uffd_pids[pid] = {
                "fd": event.fd,
                "flags": event.flags,
                "create_time": event.timestamp_ns,
                "comm": comm,
            }

            if not is_legit and event.uid != 0:
                alert = "UNPRIVILEGED_USERFAULTFD"
                severity = "critical"
                self.alert_count += 1
            elif not is_legit:
                alert = "USERFAULTFD_FD_OBTAINED"
                severity = "warning"

        if alert and not self.args.json_output:
            print(
                f"\n{'!'*70}\n"
                f"  !!! {alert} !!!\n"
                f"  PID={pid} PPID={event.ppid} COMM={comm}\n"
                f"  UID={event.uid} FD={event.fd} FLAGS={self._format_flags(event.flags)}\n"
                f"  Severity: {severity.upper()}\n"
                f"  Legitimate use of userfaultfd is rare (QEMU/KVM only).\n"
                f"  This may indicate a race condition exploit primitive.\n"
                f"{'!'*70}\n",
                flush=True,
            )

        if self.args.json_output:
            record = {
                "timestamp": timestamp,
                "pid": pid,
                "ppid": event.ppid,
                "uid": event.uid,
                "comm": comm,
                "event_type": event_name,
                "flags": event.flags,
                "flags_str": self._format_flags(event.flags),
                "fd": event.fd,
                "known_legitimate": is_legit,
                "severity": severity,
            }
            if alert:
                record["alert"] = alert
            print(json.dumps(record), flush=True)
        elif not alert:
            legit_str = " (known legitimate)" if is_legit else ""
            print(
                f"[{timestamp}] PID={pid:<8} PPID={event.ppid:<8} "
                f"UID={event.uid:<6} COMM={comm:<16} "
                f"TYPE={event_name:<24} FLAGS={self._format_flags(event.flags)}"
                f"{legit_str}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF

        self.bpf = BPF(text=BPF_PROGRAM)

        self.bpf["uffd_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing userfaultfd operations... Hit Ctrl+C to stop.\n")
        if not self.args.json_output:
            print(
                f"{'TIMESTAMP':<28} {'PID':<12} {'PPID':<12} "
                f"{'UID':<10} {'COMM':<20} {'TYPE':<28} {'FLAGS'}"
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
        print(f"\n--- userfaultfd_sniff summary ---")
        print(f"Captured {self.event_count} event(s)")
        print(f"Alerts: {self.alert_count}")
        if self.uffd_pids:
            print(f"PIDs that obtained userfaultfd: {list(self.uffd_pids.keys())}")
        if self.start_time:
            elapsed = time.monotonic() - self.start_time
            print(f"Duration: {elapsed:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor userfaultfd creation to detect race condition exploit primitives via eBPF.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 userfaultfd_sniff.py --duration 60\n"
            "  sudo python3 userfaultfd_sniff.py --json-output\n"
            "  sudo python3 userfaultfd_sniff.py --json-output --duration 300"
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

    sniffer = UserfaultfdSniffer(args)
    sniffer.run()


if __name__ == "__main__":
    main()
