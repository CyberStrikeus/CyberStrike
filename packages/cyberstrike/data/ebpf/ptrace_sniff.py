#!/usr/bin/env python3
"""
ptrace_sniff.py - Monitor ptrace-based process injection via eBPF.

Attaches to the syscalls:sys_enter_ptrace tracepoint to capture ATTACH,
POKEDATA, SETREGS operations and detect shellcode injection sequences
(ATTACH → POKEDATA → SETREGS → CONT). Requires root privileges.

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

struct ptrace_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u32 target_pid;
    u64 request;
    u64 addr;
    u64 data;
    char comm[TASK_COMM_LEN];
};

BPF_PERF_OUTPUT(ptrace_events);

TRACEPOINT_PROBE(syscalls, sys_enter_ptrace) {
    u32 pid = bpf_get_current_pid_tgid() >> 32;

    FILTER_PID

    struct ptrace_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = pid;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.request = (u64)args->request;
    event.target_pid = (u32)args->pid;
    event.addr = (u64)args->addr;
    event.data = (u64)args->data;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    ptrace_events.perf_submit(args, &event, sizeof(event));
    return 0;
}
"""


class PtraceEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("target_pid", ctypes.c_uint32),
        ("request", ctypes.c_uint64),
        ("addr", ctypes.c_uint64),
        ("data", ctypes.c_uint64),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
    ]


class PtraceSniffer:
    PTRACE_REQUESTS = {
        0: "TRACEME", 1: "PEEKTEXT", 2: "PEEKDATA", 3: "PEEKUSR",
        4: "POKETEXT", 5: "POKEDATA", 6: "POKEUSR",
        7: "CONT", 8: "KILL", 9: "SINGLESTEP",
        12: "GETREGS", 13: "SETREGS", 14: "GETFPREGS", 15: "SETFPREGS",
        16: "ATTACH", 17: "DETACH",
        24: "SYSCALL",
        16896: "SEIZE",
        16897: "INTERRUPT",
        16898: "LISTEN",
    }

    DANGEROUS_REQUESTS = {4, 5, 6, 13, 15, 16, 16896}  # POKE*, SETREGS, ATTACH, SEIZE

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.alert_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None
        self.attack_chains = {}  # target_pid -> [(request, timestamp, attacker_pid)]

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: ptrace_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  ptrace_sniff.py - Ptrace Injection Monitor (eBPF)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Tracepoint:  syscalls:sys_enter_ptrace")
        print(f"  JSON output: {self.args.json_output}")
        if self.args.pid:
            print(f"  Filter PID:  {self.args.pid} (target)")
        if self.args.duration:
            print(f"  Duration:    {self.args.duration}s")
        else:
            print("  Duration:    unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def _matches_injection_pattern(self, chain):
        """Check if the operation chain matches known injection patterns."""
        if len(chain) < 3:
            return False
        requests = [entry[0] for entry in chain]
        # Pattern 1: ATTACH + POKEDATA/POKETEXT + (SETREGS or CONT)
        has_attach = 16 in requests or 16896 in requests
        has_poke = 4 in requests or 5 in requests
        has_setregs_or_cont = 13 in requests or 7 in requests
        if has_attach and has_poke and has_setregs_or_cont:
            return True
        # Pattern 2: ATTACH + multiple POKEs (bulk shellcode write)
        poke_count = sum(1 for r in requests if r in (4, 5))
        if has_attach and poke_count >= 3:
            return True
        return False

    def _get_target_comm(self, target_pid):
        """Read target process name from /proc."""
        try:
            with open(f"/proc/{target_pid}/comm", "r") as f:
                return f.read().strip()
        except (FileNotFoundError, PermissionError):
            return "unknown"

    def handle_event(self, cpu, data, size):
        event = ctypes.cast(data, ctypes.POINTER(PtraceEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        request = event.request
        request_name = self.PTRACE_REQUESTS.get(request, f"UNKNOWN({request})")
        target_pid = event.target_pid
        is_dangerous = request in self.DANGEROUS_REQUESTS

        # Track attack chains per target
        if target_pid not in self.attack_chains:
            self.attack_chains[target_pid] = []
        self.attack_chains[target_pid].append((request, event.timestamp_ns, event.pid))

        # Detect injection pattern
        alert = None
        chain = self.attack_chains[target_pid]
        if self._matches_injection_pattern(chain):
            target_comm = self._get_target_comm(target_pid)
            alert = "PROCESS_INJECTION"
            self.alert_count += 1

            if not self.args.json_output:
                chain_str = " -> ".join(
                    self.PTRACE_REQUESTS.get(r, str(r)) for r, _, _ in chain
                )
                print(
                    f"\n{'!'*70}\n"
                    f"  !!! PROCESS INJECTION DETECTED !!!\n"
                    f"  Attacker: PID={event.pid} ({comm})\n"
                    f"  Target:   PID={target_pid} ({target_comm})\n"
                    f"  Chain:    {chain_str}\n"
                    f"{'!'*70}\n",
                    flush=True,
                )
            self.attack_chains[target_pid] = []

        if self.args.json_output:
            record = {
                "timestamp": timestamp,
                "pid": event.pid,
                "uid": event.uid,
                "comm": comm,
                "target_pid": target_pid,
                "request": request,
                "request_name": request_name,
                "addr": hex(event.addr),
                "data": hex(event.data),
                "dangerous": is_dangerous,
            }
            if alert:
                record["alert"] = alert
                record["target_comm"] = self._get_target_comm(target_pid)
                record["chain"] = [
                    self.PTRACE_REQUESTS.get(r, str(r))
                    for r, _, _ in chain
                ]
            print(json.dumps(record), flush=True)
        elif not alert:
            danger_str = " *** DANGEROUS ***" if is_dangerous else ""
            print(
                f"[{timestamp}] PID={event.pid:<8} UID={event.uid:<6} "
                f"COMM={comm:<16} REQ={request_name:<16} "
                f"TARGET={target_pid:<8} ADDR={hex(event.addr)}{danger_str}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF

        bpf_text = BPF_PROGRAM
        if self.args.pid:
            bpf_text = bpf_text.replace(
                "FILTER_PID",
                f"if ((u32)args->pid != {self.args.pid}) return 0;"
            )
        else:
            bpf_text = bpf_text.replace("FILTER_PID", "")

        self.bpf = BPF(text=bpf_text)

        self.bpf["ptrace_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing ptrace operations... Hit Ctrl+C to stop.\n")
        if not self.args.json_output:
            print(
                f"{'TIMESTAMP':<28} {'PID':<12} {'UID':<10} "
                f"{'COMM':<20} {'REQUEST':<20} {'TARGET':<12} {'ADDR'}"
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
        print(f"\n--- ptrace_sniff summary ---")
        print(f"Captured {self.event_count} ptrace event(s)")
        print(f"Injection alerts: {self.alert_count}")
        if self.start_time:
            elapsed = time.monotonic() - self.start_time
            print(f"Duration: {elapsed:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor ptrace-based process injection via eBPF tracepoint.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 ptrace_sniff.py --duration 60\n"
            "  sudo python3 ptrace_sniff.py --pid 1234 --json-output\n"
            "  sudo python3 ptrace_sniff.py --json-output | jq 'select(.alert)'"
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
        "--pid",
        type=int,
        default=None,
        help="Filter: only show ptrace operations targeting this PID",
    )
    args = parser.parse_args()

    sniffer = PtraceSniffer(args)
    sniffer.run()


if __name__ == "__main__":
    main()
