#!/usr/bin/env python3
"""
bpf_integrity.py - Monitor bpf() syscall and verify eBPF program integrity.

Attaches to syscalls:sys_enter_bpf tracepoint to monitor BPF program loading,
attaching, and detaching. Optionally takes a baseline snapshot via bpftool and
periodically verifies CyberStrike programs haven't been tampered with.
Requires root privileges.

Part of CyberStrike offensive security platform.
"""

import argparse
import ctypes
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime

TASK_COMM_LEN = 16
MAX_PROG_NAME_LEN = 16

BPF_PROGRAM = r"""
#include <uapi/linux/ptrace.h>
#include <linux/sched.h>

#define MAX_PROG_NAME_LEN 16

struct bpf_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u32 cmd;
    u32 prog_type;
    u32 attach_type;
    u32 insn_cnt;
    char comm[TASK_COMM_LEN];
    char prog_name[MAX_PROG_NAME_LEN];
};

BPF_PERF_OUTPUT(bpf_events);

TRACEPOINT_PROBE(syscalls, sys_enter_bpf) {
    u32 cmd = (u32)args->cmd;

    // Only capture interesting commands
    // 0=MAP_CREATE, 2=MAP_UPDATE, 3=MAP_DELETE, 5=PROG_LOAD,
    // 8=PROG_ATTACH, 9=PROG_DETACH, 28=LINK_CREATE, 29=LINK_UPDATE, 30=LINK_DETACH
    if (cmd != 0 && cmd != 2 && cmd != 3 && cmd != 5 &&
        cmd != 8 && cmd != 9 && cmd != 28 && cmd != 29 && cmd != 30)
        return 0;

    struct bpf_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.cmd = cmd;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    // For PROG_LOAD, read prog_type and prog_name from bpf_attr
    if (cmd == 5) {
        bpf_probe_read_user(&event.prog_type, sizeof(event.prog_type), (void *)args->uattr);
        bpf_probe_read_user(&event.insn_cnt, sizeof(event.insn_cnt), (void *)(args->uattr + 4));
        // prog_name offset in bpf_attr for PROG_LOAD is at byte 65 (kernel 4.15+)
        bpf_probe_read_user_str(&event.prog_name, sizeof(event.prog_name), (void *)(args->uattr + 65));
    }

    if (cmd == 8 || cmd == 9) {
        bpf_probe_read_user(&event.attach_type, sizeof(event.attach_type), (void *)(args->uattr + 4));
    }

    bpf_events.perf_submit(args, &event, sizeof(event));
    return 0;
}
"""


class BpfEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("cmd", ctypes.c_uint32),
        ("prog_type", ctypes.c_uint32),
        ("attach_type", ctypes.c_uint32),
        ("insn_cnt", ctypes.c_uint32),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
        ("prog_name", ctypes.c_char * MAX_PROG_NAME_LEN),
    ]


class BpfIntegrityMonitor:
    BPF_CMDS = {
        0: "MAP_CREATE", 1: "MAP_LOOKUP_ELEM", 2: "MAP_UPDATE_ELEM",
        3: "MAP_DELETE_ELEM", 5: "PROG_LOAD", 6: "PROG_ATTACH_LEGACY",
        8: "PROG_ATTACH", 9: "PROG_DETACH", 10: "PROG_TEST_RUN",
        11: "PROG_GET_NEXT_ID", 12: "MAP_GET_NEXT_ID",
        13: "PROG_GET_FD_BY_ID", 18: "BTF_LOAD",
        28: "LINK_CREATE", 29: "LINK_UPDATE", 30: "LINK_DETACH",
    }

    PROG_TYPES = {
        1: "KPROBE", 2: "SCHED_CLS", 3: "SCHED_ACT",
        5: "TRACEPOINT", 6: "XDP", 7: "PERF_EVENT",
        14: "RAW_TRACEPOINT", 17: "CGROUP_SOCKOPT",
        26: "LSM", 29: "SYSCALL",
    }

    DANGEROUS_CMDS = {5, 8, 9, 28, 29, 30}  # PROG_LOAD, ATTACH, DETACH, LINK_*

    CYBERSTRIKE_PATTERNS = [
        r"^cs_", r"^cyberstrike_", r"^pam_sniff", r"^ssl_sniff",
        r"^dep_scan", r"^net_monitor", r"^proc_exec", r"^file_watch",
        r"^priv_esc", r"^cred_dump", r"^keylog", r"^shell_snoop",
        r"^dns_sniff", r"^sock_trace", r"^syscall_hook",
        r"^io_uring", r"^memfd", r"^ptrace_sniff", r"^crossmem",
        r"^uffd", r"^bpf_integrity", r"^netlink_sniff", r"^seccomp_sniff",
        r"^trace_", r"^proc_hide", r"^file_hide", r"^conn_hide",
        r"^execve_sniff",
    ]
    COMPILED_PATTERNS = [re.compile(p, re.IGNORECASE) for p in CYBERSTRIKE_PATTERNS]

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.alert_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None
        self.baseline = None
        self.integrity_thread = None
        self.my_pid = os.getpid()

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: bpf_integrity.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def _take_snapshot(self):
        """Take a snapshot of loaded BPF programs via bpftool."""
        try:
            result = subprocess.run(
                ["bpftool", "prog", "list", "--json"],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0:
                return json.loads(result.stdout)
        except (subprocess.TimeoutExpired, FileNotFoundError, json.JSONDecodeError):
            pass
        return []

    def _matches_cyberstrike(self, name):
        """Check if a program name matches CyberStrike patterns."""
        for pattern in self.COMPILED_PATTERNS:
            if pattern.search(name):
                return True
        return False

    def _integrity_check_loop(self):
        """Periodically compare current BPF programs against baseline."""
        interval = self.args.check_interval
        while self.running:
            time.sleep(interval)
            if not self.running:
                break
            self._run_integrity_check()

    def _run_integrity_check(self):
        """Compare current state against baseline."""
        if not self.baseline:
            return

        current = self._take_snapshot()
        baseline_ids = {p.get("id") for p in self.baseline if "id" in p}
        current_ids = {p.get("id") for p in current if "id" in p}

        # Check for removed programs
        missing_ids = baseline_ids - current_ids
        if missing_ids:
            # Check if any missing program was a CyberStrike program
            missing_progs = [
                p for p in self.baseline
                if p.get("id") in missing_ids
            ]
            cs_missing = [
                p for p in missing_progs
                if self._matches_cyberstrike(p.get("name", ""))
            ]

            if cs_missing:
                self.alert_count += 1
                timestamp = datetime.now().isoformat()
                names = [p.get("name", "?") for p in cs_missing]
                msg = f"INTEGRITY VIOLATION: {len(cs_missing)} CyberStrike BPF program(s) removed: {names}"

                if self.args.json_output:
                    print(json.dumps({
                        "timestamp": timestamp,
                        "alert": "INTEGRITY_VIOLATION",
                        "severity": "critical",
                        "missing_programs": [
                            {"id": p.get("id"), "name": p.get("name"), "type": p.get("type")}
                            for p in cs_missing
                        ],
                    }), flush=True)
                else:
                    print(
                        f"\n{'!'*70}\n"
                        f"  !!! INTEGRITY VIOLATION !!!\n"
                        f"  {len(cs_missing)} CyberStrike BPF program(s) removed since baseline.\n"
                        f"  Programs: {names}\n"
                        f"  This may indicate hook evasion or tampering.\n"
                        f"{'!'*70}\n",
                        flush=True,
                    )

        # Check for new unknown BPF programs
        new_ids = current_ids - baseline_ids
        if new_ids:
            new_progs = [p for p in current if p.get("id") in new_ids]
            for prog in new_progs:
                name = prog.get("name", "")
                if name and not self._matches_cyberstrike(name):
                    timestamp = datetime.now().isoformat()
                    if self.args.json_output:
                        print(json.dumps({
                            "timestamp": timestamp,
                            "alert": "NEW_BPF_PROGRAM",
                            "severity": "warning",
                            "program": {
                                "id": prog.get("id"),
                                "name": name,
                                "type": prog.get("type"),
                            },
                        }), flush=True)
                    else:
                        print(
                            f"[{timestamp}] WARNING: New unknown BPF program loaded: "
                            f"id={prog.get('id')} name={name} type={prog.get('type')}",
                            flush=True,
                        )

    def print_banner(self):
        print("=" * 70)
        print("  bpf_integrity.py - BPF Program Integrity Monitor (eBPF)")
        print("=" * 70)
        print(f"  PID:            {self.my_pid}")
        print(f"  Tracepoint:     syscalls:sys_enter_bpf")
        print(f"  Baseline:       {'enabled' if self.args.baseline else 'disabled'}")
        if self.args.baseline:
            print(f"  Check interval: {self.args.check_interval}s")
        print(f"  JSON output:    {self.args.json_output}")
        if self.args.duration:
            print(f"  Duration:       {self.args.duration}s")
        else:
            print("  Duration:       unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def handle_event(self, cpu, data, size):
        event = ctypes.cast(data, ctypes.POINTER(BpfEvent)).contents

        # Skip our own BPF operations
        if event.pid == self.my_pid:
            return

        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        prog_name = event.prog_name.decode("utf-8", errors="replace").rstrip("\x00")
        cmd = event.cmd
        cmd_name = self.BPF_CMDS.get(cmd, f"UNKNOWN({cmd})")
        prog_type_name = self.PROG_TYPES.get(event.prog_type, f"type={event.prog_type}")
        is_dangerous = cmd in self.DANGEROUS_CMDS

        alert = None
        severity = "info"

        if cmd == 5:  # PROG_LOAD
            if self._matches_cyberstrike(prog_name) and event.pid != self.my_pid:
                alert = "CYBERSTRIKE_NAME_IMPERSONATION"
                severity = "critical"
                self.alert_count += 1
            elif is_dangerous:
                alert = "BPF_PROG_LOAD"
                severity = "warning"
                self.alert_count += 1

        elif cmd == 9:  # PROG_DETACH
            alert = "BPF_PROG_DETACH"
            severity = "warning"
            self.alert_count += 1

        elif cmd == 30:  # LINK_DETACH
            alert = "BPF_LINK_DETACH"
            severity = "warning"
            self.alert_count += 1

        if self.args.json_output:
            record = {
                "timestamp": timestamp,
                "pid": event.pid,
                "uid": event.uid,
                "comm": comm,
                "cmd": cmd,
                "cmd_name": cmd_name,
                "dangerous": is_dangerous,
            }
            if cmd == 5:
                record["prog_type"] = prog_type_name
                record["prog_name"] = prog_name
                record["insn_cnt"] = event.insn_cnt
            if alert:
                record["alert"] = alert
                record["severity"] = severity
            print(json.dumps(record), flush=True)
        else:
            prog_info = ""
            if cmd == 5:
                prog_info = f" PROG={prog_name} TYPE={prog_type_name} INSNS={event.insn_cnt}"
            danger_str = " *** DANGEROUS ***" if is_dangerous else ""
            alert_str = f" !!! {alert} !!!" if alert else ""
            print(
                f"[{timestamp}] PID={event.pid:<8} UID={event.uid:<6} "
                f"COMM={comm:<16} CMD={cmd_name:<20}"
                f"{prog_info}{danger_str}{alert_str}",
                flush=True,
            )

    def run(self):
        self.check_root()

        if self.args.baseline:
            print("Taking baseline snapshot of loaded BPF programs...")
            self.baseline = self._take_snapshot()
            cs_progs = [
                p for p in self.baseline
                if self._matches_cyberstrike(p.get("name", ""))
            ]
            print(f"Baseline: {len(self.baseline)} total programs, {len(cs_progs)} CyberStrike programs")

        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF

        self.bpf = BPF(text=BPF_PROGRAM)

        self.bpf["bpf_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        if self.args.baseline:
            self.integrity_thread = threading.Thread(
                target=self._integrity_check_loop, daemon=True
            )
            self.integrity_thread.start()

        print("Monitoring bpf() syscall... Hit Ctrl+C to stop.\n")
        if not self.args.json_output:
            print(
                f"{'TIMESTAMP':<28} {'PID':<12} {'UID':<10} "
                f"{'COMM':<20} {'CMD':<24} {'INFO'}"
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
        self.running = False
        if self.integrity_thread and self.integrity_thread.is_alive():
            self.integrity_thread.join(timeout=2)

        print(f"\n--- bpf_integrity summary ---")
        print(f"Captured {self.event_count} bpf() event(s)")
        print(f"Alerts: {self.alert_count}")
        if self.baseline:
            print(f"Baseline programs: {len(self.baseline)}")
            self._run_integrity_check()
        if self.start_time:
            elapsed = time.monotonic() - self.start_time
            print(f"Duration: {elapsed:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor bpf() syscall and verify eBPF program integrity via eBPF tracepoint.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 bpf_integrity.py --duration 60\n"
            "  sudo python3 bpf_integrity.py --baseline --duration 300\n"
            "  sudo python3 bpf_integrity.py --baseline --check-interval 10 --json-output"
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
    parser.add_argument(
        "--baseline",
        action="store_true",
        default=False,
        help="Take initial BPF program snapshot and verify integrity periodically",
    )
    parser.add_argument(
        "--check-interval",
        type=int,
        default=30,
        metavar="SECONDS",
        help="Seconds between integrity checks (default: 30)",
    )
    args = parser.parse_args()

    monitor = BpfIntegrityMonitor(args)
    monitor.run()


if __name__ == "__main__":
    main()
