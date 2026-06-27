#!/usr/bin/env python3
"""
seccomp_sniff.py - Monitor prctl and seccomp syscalls via eBPF.

Attaches to syscalls:sys_enter_prctl and syscalls:sys_enter_seccomp
tracepoints to detect processes weakening their own security profiles,
changing names for masquerading, or disabling privilege restrictions.
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
MAX_NAME_LEN = 16

BPF_PROGRAM = r"""
#include <uapi/linux/ptrace.h>
#include <linux/sched.h>

#define MAX_NAME_LEN 16

struct seccomp_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u64 option;
    u64 arg2;
    u64 arg3;
    u64 arg4;
    u8  syscall_type;   // 0=prctl, 1=seccomp
    u32 ppid;
    char comm[TASK_COMM_LEN];
    char new_name[MAX_NAME_LEN];
};

BPF_PERF_OUTPUT(seccomp_events);

TRACEPOINT_PROBE(syscalls, sys_enter_prctl) {
    u64 option = (u64)args->option;

    // Only capture security-relevant prctl calls
    // PR_SET_SECCOMP=22, PR_SET_NO_NEW_PRIVS=38, PR_SET_DUMPABLE=4,
    // PR_SET_NAME=15, PR_SET_PDEATHSIG=1, PR_SET_PTRACER=0x59616d61
    if (option != 22 && option != 38 && option != 4 && option != 15 &&
        option != 1 && option != 0x59616d61)
        return 0;

    struct seccomp_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.option = option;
    event.arg2 = (u64)args->arg2;
    event.arg3 = (u64)args->arg3;
    event.arg4 = (u64)args->arg4;
    event.syscall_type = 0;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    struct task_struct *task = (struct task_struct *)bpf_get_current_task();
    event.ppid = task->real_parent->tgid;

    // For PR_SET_NAME, read the new name
    if (option == 15) {
        bpf_probe_read_user_str(&event.new_name, sizeof(event.new_name), (void *)args->arg2);
    }

    seccomp_events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_seccomp) {
    struct seccomp_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.option = (u64)args->op;
    event.arg2 = (u64)args->flags;
    event.syscall_type = 1;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    struct task_struct *task = (struct task_struct *)bpf_get_current_task();
    event.ppid = task->real_parent->tgid;

    seccomp_events.perf_submit(args, &event, sizeof(event));
    return 0;
}
"""


class SeccompEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("option", ctypes.c_uint64),
        ("arg2", ctypes.c_uint64),
        ("arg3", ctypes.c_uint64),
        ("arg4", ctypes.c_uint64),
        ("syscall_type", ctypes.c_uint8),
        ("ppid", ctypes.c_uint32),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
        ("new_name", ctypes.c_char * MAX_NAME_LEN),
    ]


class SeccompSniffer:
    PRCTL_OPTIONS = {
        1: "PR_SET_PDEATHSIG",
        4: "PR_SET_DUMPABLE",
        15: "PR_SET_NAME",
        22: "PR_SET_SECCOMP",
        38: "PR_SET_NO_NEW_PRIVS",
        0x59616d61: "PR_SET_PTRACER",
    }

    SECCOMP_OPS = {
        0: "SET_MODE_STRICT",
        1: "SET_MODE_FILTER",
        2: "GET_ACTION_AVAIL",
        3: "GET_NOTIF_SIZES",
    }

    PR_SET_PTRACER_ANY = 0xFFFFFFFF

    # Threat classification: (syscall_type, option, arg2) -> (severity, description)
    # arg2=None means any value matches
    THREAT_MAP = {
        # prctl: PR_SET_SECCOMP with arg2=0 → disabling seccomp
        (0, 22, 0): ("critical", "Seccomp disabled — sandbox escape possible"),
        # prctl: PR_SET_NO_NEW_PRIVS with arg2=0 → allows future privilege escalation
        (0, 38, 0): ("high", "NO_NEW_PRIVS disabled — privilege escalation possible"),
        # prctl: PR_SET_DUMPABLE with arg2=1 → core dumps may leak credentials
        (0, 4, 1): ("medium", "Process set dumpable — core dump credential leak risk"),
        # prctl: PR_SET_PTRACER to ANY → allows any process to ptrace
        (0, 0x59616d61, 0xFFFFFFFF): ("high", "PR_SET_PTRACER set to ANY — allows any process to ptrace"),
    }

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.alert_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None
        self.name_changes = {}  # pid -> [(old_name, new_name, timestamp)]

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: seccomp_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  seccomp_sniff.py - Seccomp/Prctl Security Monitor (eBPF)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Hooks:       sys_enter_prctl + sys_enter_seccomp")
        print(f"  JSON output: {self.args.json_output}")
        if self.args.duration:
            print(f"  Duration:    {self.args.duration}s")
        else:
            print("  Duration:    unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def _classify_threat(self, syscall_type, option, arg2):
        """Classify the threat level of a prctl/seccomp operation."""
        # Check exact match first
        key = (syscall_type, option, arg2)
        if key in self.THREAT_MAP:
            return self.THREAT_MAP[key]

        # PR_SET_NAME is always interesting (masquerading)
        if syscall_type == 0 and option == 15:
            return ("low", "Process name change — possible masquerading")

        # PR_SET_PTRACER with non-zero, non-ANY value
        if syscall_type == 0 and option == 0x59616d61 and arg2 != 0:
            return ("medium", f"PR_SET_PTRACER set to PID {arg2}")

        # PR_SET_PDEATHSIG
        if syscall_type == 0 and option == 1:
            return ("info", f"PR_SET_PDEATHSIG set to signal {arg2}")

        # seccomp SET_MODE_STRICT
        if syscall_type == 1 and option == 0:
            return ("info", "Seccomp STRICT mode enabled")

        # seccomp SET_MODE_FILTER
        if syscall_type == 1 and option == 1:
            return ("info", "Seccomp BPF filter installed")

        return ("info", "Security-relevant syscall")

    def handle_event(self, cpu, data, size):
        event = ctypes.cast(data, ctypes.POINTER(SeccompEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        new_name = event.new_name.decode("utf-8", errors="replace").rstrip("\x00")
        pid = event.pid
        syscall_type = event.syscall_type
        option = event.option
        arg2 = event.arg2

        if syscall_type == 0:
            syscall_name = "prctl"
            option_name = self.PRCTL_OPTIONS.get(option, f"UNKNOWN({option})")
        else:
            syscall_name = "seccomp"
            option_name = self.SECCOMP_OPS.get(option, f"UNKNOWN({option})")

        severity, description = self._classify_threat(syscall_type, option, arg2)

        # Track name changes for masquerading detection
        alert = None
        if syscall_type == 0 and option == 15 and new_name:
            if pid not in self.name_changes:
                self.name_changes[pid] = []
            self.name_changes[pid].append((comm, new_name, timestamp))
            if len(self.name_changes[pid]) >= 2:
                alert = "PROCESS_MASQUERADING"
                severity = "high"

        if severity in ("critical", "high"):
            alert = alert or description.split(" —")[0].replace(" ", "_").upper()
            self.alert_count += 1

            if not self.args.json_output:
                print(
                    f"\n{'!'*70}\n"
                    f"  !!! {severity.upper()}: {description} !!!\n"
                    f"  PID={pid} PPID={event.ppid} COMM={comm}\n"
                    f"  UID={event.uid} SYSCALL={syscall_name}\n"
                    f"  OPTION={option_name} ARG2={arg2}",
                    end="",
                    flush=True,
                )
                if new_name:
                    print(f" NEW_NAME={new_name}", end="")
                print(f"\n{'!'*70}\n", flush=True)

        if self.args.json_output:
            record = {
                "timestamp": timestamp,
                "pid": pid,
                "ppid": event.ppid,
                "uid": event.uid,
                "comm": comm,
                "syscall": syscall_name,
                "option": option,
                "option_name": option_name,
                "arg2": arg2,
                "arg3": event.arg3,
                "severity": severity,
                "description": description,
            }
            if new_name:
                record["new_name"] = new_name
            if alert:
                record["alert"] = alert
            print(json.dumps(record), flush=True)
        elif not alert:
            name_str = f" -> {new_name}" if new_name else ""
            print(
                f"[{timestamp}] PID={pid:<8} PPID={event.ppid:<8} "
                f"UID={event.uid:<6} COMM={comm:<16} "
                f"CALL={syscall_name:<8} OPT={option_name:<24} "
                f"SEV={severity}{name_str}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF

        self.bpf = BPF(text=BPF_PROGRAM)

        self.bpf["seccomp_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing prctl/seccomp operations... Hit Ctrl+C to stop.\n")
        if not self.args.json_output:
            print(
                f"{'TIMESTAMP':<28} {'PID':<12} {'PPID':<12} "
                f"{'UID':<10} {'COMM':<20} {'CALL':<10} {'OPTION':<28} {'SEV'}"
            )
            print("-" * 140)

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
        print(f"\n--- seccomp_sniff summary ---")
        print(f"Captured {self.event_count} event(s)")
        print(f"Alerts: {self.alert_count}")
        if self.name_changes:
            print(f"PIDs with name changes: {len(self.name_changes)}")
            for pid, changes in self.name_changes.items():
                for old, new, ts in changes:
                    print(f"  PID {pid}: {old} -> {new} at {ts}")
        if self.start_time:
            elapsed = time.monotonic() - self.start_time
            print(f"Duration: {elapsed:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor prctl and seccomp syscalls for security profile self-modification via eBPF.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 seccomp_sniff.py --duration 60\n"
            "  sudo python3 seccomp_sniff.py --json-output\n"
            "  sudo python3 seccomp_sniff.py --json-output | jq 'select(.severity == \"critical\")'"
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

    sniffer = SeccompSniffer(args)
    sniffer.run()


if __name__ == "__main__":
    main()
