#!/usr/bin/env python3
"""
futex_sniff.py - Monitor futex operations for covert channels via eBPF.

Attaches to syscalls:sys_enter_futex tracepoint to detect timing-based
covert channels that use FUTEX_WAIT/FUTEX_WAKE sequences for inter-process
signaling. Also detects high-frequency futex loops used in busy-wait
exploitation. Requires root privileges.

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

#define FUTEX_WAIT         0
#define FUTEX_WAKE         1
#define FUTEX_WAIT_BITSET  9
#define FUTEX_WAKE_BITSET 10
#define FUTEX_LOCK_PI      6
#define FUTEX_UNLOCK_PI    7
#define FUTEX_CMD_MASK   0x7F

struct futex_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u32 op;             // FUTEX_WAIT=0, FUTEX_WAKE=1, etc.
    u64 uaddr;          // futex address
    u32 val;            // expected value (WAIT) or number to wake (WAKE)
    u64 timeout_ns;     // timeout for WAIT operations
    u32 val3;           // bitset for WAIT_BITSET/WAKE_BITSET
    char comm[TASK_COMM_LEN];
};

BPF_PERF_OUTPUT(futex_events);
BPF_HASH(futex_count, u32, u64);  // pid -> call count (for frequency detection)

TRACEPOINT_PROBE(syscalls, sys_enter_futex) {
    u32 op = (u32)args->op & FUTEX_CMD_MASK;

    // Only capture WAIT, WAKE, WAIT_BITSET, WAKE_BITSET, LOCK_PI, UNLOCK_PI
    if (op != FUTEX_WAIT && op != FUTEX_WAKE &&
        op != FUTEX_WAIT_BITSET && op != FUTEX_WAKE_BITSET &&
        op != FUTEX_LOCK_PI && op != FUTEX_UNLOCK_PI)
        return 0;

    u32 pid = bpf_get_current_pid_tgid() >> 32;

    // Count calls per PID
    u64 *count = futex_count.lookup(&pid);
    if (count) {
        (*count)++;
        // Only report every 1000th call for high-frequency
        if (*count % 1000 != 0 && *count > 1000)
            return 0;
    } else {
        u64 one = 1;
        futex_count.update(&pid, &one);
    }

    struct futex_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = pid;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.op = op;
    event.uaddr = (u64)args->uaddr;
    event.val = (u32)args->val;
    event.val3 = (u32)args->val3;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    // Read timeout if available (for WAIT operations)
    if (op == FUTEX_WAIT || op == FUTEX_WAIT_BITSET) {
        struct timespec *ts = (struct timespec *)args->utime;
        if (ts) {
            struct timespec ts_val = {};
            bpf_probe_read_user(&ts_val, sizeof(ts_val), ts);
            event.timeout_ns = ts_val.tv_sec * 1000000000ULL + ts_val.tv_nsec;
        }
    }

    futex_events.perf_submit(args, &event, sizeof(event));
    return 0;
}
"""


class FutexEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("op", ctypes.c_uint32),
        ("uaddr", ctypes.c_uint64),
        ("val", ctypes.c_uint32),
        ("timeout_ns", ctypes.c_uint64),
        ("val3", ctypes.c_uint32),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
    ]


class FutexSniffer:
    FUTEX_OPS = {
        0: "WAIT", 1: "WAKE", 2: "FD", 3: "REQUEUE",
        4: "CMP_REQUEUE", 5: "WAKE_OP",
        6: "LOCK_PI", 7: "UNLOCK_PI", 8: "TRYLOCK_PI",
        9: "WAIT_BITSET", 10: "WAKE_BITSET",
        11: "WAIT_REQUEUE_PI", 12: "CMP_REQUEUE_PI",
    }

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.alert_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None
        self.pid_addrs = {}  # pid -> {uaddr: {wait_count, wake_count, last_op}}
        self.covert_pairs = {}  # (pid1, pid2) -> shared_addr

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: futex_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  futex_sniff.py - Futex Covert Channel Monitor (eBPF)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Hooks:       futex (WAIT/WAKE/BITSET/PI)")
        print(f"  JSON output: {self.args.json_output}")
        if self.args.duration:
            print(f"  Duration:    {self.args.duration}s")
        else:
            print("  Duration:    unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def _detect_covert_channel(self, pid, uaddr, op):
        """Detect WAIT/WAKE pairs on same address from different PIDs."""
        if pid not in self.pid_addrs:
            self.pid_addrs[pid] = {}
        if uaddr not in self.pid_addrs[pid]:
            self.pid_addrs[pid][uaddr] = {"wait": 0, "wake": 0}

        if op in (0, 9):  # WAIT, WAIT_BITSET
            self.pid_addrs[pid][uaddr]["wait"] += 1
        elif op in (1, 10):  # WAKE, WAKE_BITSET
            self.pid_addrs[pid][uaddr]["wake"] += 1

        # Check if another PID uses the same address with opposite operation
        for other_pid, addrs in self.pid_addrs.items():
            if other_pid == pid:
                continue
            if uaddr in addrs:
                other = addrs[uaddr]
                current = self.pid_addrs[pid][uaddr]
                # One PIDs WAITs, other WAKEs = covert channel
                if (current["wait"] > 0 and other["wake"] > 0) or \
                   (current["wake"] > 0 and other["wait"] > 0):
                    pair = tuple(sorted([pid, other_pid]))
                    if pair not in self.covert_pairs:
                        self.covert_pairs[pair] = uaddr
                        return True, other_pid
        return False, None

    def handle_event(self, cpu, data, size):
        event = ctypes.cast(data, ctypes.POINTER(FutexEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        pid = event.pid
        op = event.op
        op_name = self.FUTEX_OPS.get(op, f"OP({op})")
        uaddr = event.uaddr

        alert = None
        severity = "info"

        # Detect covert channel (WAIT/WAKE pair across PIDs on same address)
        is_covert, other_pid = self._detect_covert_channel(pid, uaddr, op)
        if is_covert:
            alert = "FUTEX_COVERT_CHANNEL"
            severity = "critical"
            self.alert_count += 1

        # Short timeout WAIT = busy-wait loop (potential timing attack)
        if op in (0, 9) and event.timeout_ns > 0 and event.timeout_ns < 1000000:  # < 1ms
            alert = "FUTEX_BUSYWAIT"
            severity = "warning"
            self.alert_count += 1

        # PI futex operations (priority inheritance) are rare in normal code
        if op in (6, 7):
            alert = "FUTEX_PI_OPERATION"
            severity = "warning"
            self.alert_count += 1

        if alert and not self.args.json_output:
            print(
                f"\n{'!'*70}\n"
                f"  !!! {alert} !!!\n"
                f"  PID={pid} COMM={comm}\n"
                f"  OP={op_name} ADDR={hex(uaddr)} VAL={event.val}",
                end="", flush=True,
            )
            if is_covert and other_pid:
                print(f"\n  PARTNER_PID={other_pid}", end="")
            if event.timeout_ns > 0:
                print(f"\n  TIMEOUT={event.timeout_ns}ns", end="")
            print(f"\n{'!'*70}\n", flush=True)

        if self.args.json_output:
            record = {
                "timestamp": timestamp, "pid": pid, "uid": event.uid,
                "comm": comm, "op": op_name, "uaddr": hex(uaddr),
                "val": event.val, "severity": severity,
            }
            if event.timeout_ns > 0:
                record["timeout_ns"] = event.timeout_ns
            if op in (9, 10):
                record["bitset"] = hex(event.val3)
            if is_covert and other_pid:
                record["partner_pid"] = other_pid
            if alert:
                record["alert"] = alert
            print(json.dumps(record), flush=True)
        elif not alert:
            timeout_str = f" TIMEOUT={event.timeout_ns}ns" if event.timeout_ns > 0 else ""
            print(
                f"[{timestamp}] PID={pid:<8} UID={event.uid:<6} "
                f"COMM={comm:<16} OP={op_name:<16} "
                f"ADDR={hex(uaddr)} VAL={event.val}{timeout_str}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.print_banner()
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF
        self.bpf = BPF(text=BPF_PROGRAM)
        self.bpf["futex_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing futex operations... Hit Ctrl+C to stop.\n")
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
        print(f"\n--- futex_sniff summary ---")
        print(f"Captured {self.event_count} event(s), Alerts: {self.alert_count}")
        if self.covert_pairs:
            print(f"Suspected covert channel pairs: {len(self.covert_pairs)}")
            for (pid1, pid2), addr in self.covert_pairs.items():
                print(f"  PID {pid1} <-> PID {pid2} via futex addr {hex(addr)}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor futex operations for covert channel and timing attack detection via eBPF.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n  sudo python3 futex_sniff.py --duration 60\n  sudo python3 futex_sniff.py --json-output",
    )
    parser.add_argument("--json-output", action="store_true", default=False)
    parser.add_argument("--duration", type=int, default=None, metavar="SECONDS")
    args = parser.parse_args()
    FutexSniffer(args).run()


if __name__ == "__main__":
    main()
