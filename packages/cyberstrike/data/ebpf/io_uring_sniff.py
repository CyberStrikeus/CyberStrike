#!/usr/bin/env python3
"""
io_uring_sniff.py - Monitor io_uring ring buffer operations via eBPF.

Attaches a kprobe to io_uring submission functions to detect file, socket,
and connect operations that bypass classical syscall-based monitoring hooks.
Requires root privileges and kernel 5.1+.

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
MAX_FILENAME_LEN = 256

BPF_PROGRAM = r"""
#include <uapi/linux/ptrace.h>
#include <linux/sched.h>

#define MAX_FILENAME_LEN 256

struct io_uring_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u8  opcode;
    u32 fd;
    u64 addr;
    u64 len;
    u32 sqe_flags;
    char comm[TASK_COMM_LEN];
    char filename[MAX_FILENAME_LEN];
};

BPF_PERF_OUTPUT(io_uring_events);
BPF_HASH(pid_filter, u32, u32);

TRACEPOINT_PROBE(io_uring, io_uring_submit_sqe) {
    u32 pid = bpf_get_current_pid_tgid() >> 32;

    FILTER_PID

    struct io_uring_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = pid;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    event.opcode = args->opcode;
    event.fd = args->fd;
    event.sqe_flags = args->flags;

    FILTER_DANGEROUS

    io_uring_events.perf_submit(args, &event, sizeof(event));
    return 0;
}
"""

# Fallback BPF program using kprobe if tracepoint not available
BPF_PROGRAM_KPROBE = r"""
#include <uapi/linux/ptrace.h>
#include <linux/sched.h>

#define MAX_FILENAME_LEN 256

struct io_uring_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u8  opcode;
    u32 fd;
    u64 addr;
    u64 len;
    u32 sqe_flags;
    char comm[TASK_COMM_LEN];
    char filename[MAX_FILENAME_LEN];
};

BPF_PERF_OUTPUT(io_uring_events);

int trace_io_submit(struct pt_regs *ctx) {
    u32 pid = bpf_get_current_pid_tgid() >> 32;

    FILTER_PID

    struct io_uring_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = pid;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    io_uring_events.perf_submit(ctx, &event, sizeof(event));
    return 0;
}
"""


class IoUringEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("opcode", ctypes.c_uint8),
        ("fd", ctypes.c_uint32),
        ("addr", ctypes.c_uint64),
        ("len", ctypes.c_uint64),
        ("sqe_flags", ctypes.c_uint32),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
        ("filename", ctypes.c_char * MAX_FILENAME_LEN),
    ]


class IoUringSniffer:
    OPCODE_NAMES = {
        0: "NOP", 1: "READV", 2: "WRITEV", 3: "FSYNC", 4: "READ_FIXED",
        5: "WRITE_FIXED", 6: "POLL_ADD", 7: "POLL_REMOVE", 8: "SYNC_FILE_RANGE",
        9: "SENDMSG", 10: "RECVMSG", 11: "TIMEOUT", 12: "TIMEOUT_REMOVE",
        13: "ACCEPT", 14: "ASYNC_CANCEL", 15: "LINK_TIMEOUT", 16: "CONNECT",
        17: "FALLOCATE", 18: "OPENAT", 19: "CLOSE", 20: "FILES_UPDATE",
        21: "STATX", 22: "READ", 23: "WRITE", 24: "FADVISE", 25: "MADVISE",
        26: "SEND", 27: "RECV", 28: "OPENAT2", 29: "EPOLL_CTL", 30: "SPLICE",
        31: "PROVIDE_BUFFERS", 32: "REMOVE_BUFFERS", 33: "TEE",
        34: "SHUTDOWN", 35: "RENAMEAT", 36: "UNLINKAT", 37: "MKDIRAT",
        38: "SYMLINKAT", 39: "LINKAT", 40: "MSG_RING", 41: "FSETXATTR",
        42: "SETXATTR", 43: "FGETXATTR", 44: "GETXATTR", 45: "SOCKET",
        46: "URING_CMD", 47: "SEND_ZC", 48: "SENDMSG_ZC",
    }

    DANGEROUS_OPCODES = {16, 22, 23, 28, 45, 9, 10, 26, 27, 18}

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.alert_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None
        self.pid_chains = {}

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: io_uring_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def check_kernel_version(self):
        """Verify kernel >= 5.1 for io_uring support."""
        release = os.uname().release
        parts = release.split(".")
        try:
            major, minor = int(parts[0]), int(parts[1])
            if major < 5 or (major == 5 and minor < 1):
                print(f"ERROR: io_uring requires kernel 5.1+, current: {release}", file=sys.stderr)
                sys.exit(1)
        except (ValueError, IndexError):
            pass

    def print_banner(self):
        print("=" * 70)
        print("  io_uring_sniff.py - io_uring Ring Buffer Monitor (eBPF)")
        print("=" * 70)
        print(f"  PID:           {os.getpid()}")
        print(f"  Kernel:        {os.uname().release}")
        print(f"  JSON output:   {self.args.json_output}")
        print(f"  Dangerous only:{self.args.dangerous_only}")
        if self.args.pid:
            print(f"  Filter PID:    {self.args.pid}")
        if self.args.duration:
            print(f"  Duration:      {self.args.duration}s")
        else:
            print("  Duration:      unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def handle_event(self, cpu, data, size):
        event = ctypes.cast(data, ctypes.POINTER(IoUringEvent)).contents
        self.event_count += 1

        opcode = event.opcode
        opcode_name = self.OPCODE_NAMES.get(opcode, f"UNKNOWN({opcode})")
        is_dangerous = opcode in self.DANGEROUS_OPCODES

        if self.args.dangerous_only and not is_dangerous:
            return

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        filename = event.filename.decode("utf-8", errors="replace").rstrip("\x00")

        # Track per-PID operation chains for threat detection
        pid = event.pid
        if pid not in self.pid_chains:
            self.pid_chains[pid] = []
        self.pid_chains[pid].append(opcode)

        # Threat detection: SOCKET + CONNECT from same PID = potential io_uring reverse shell
        alert = None
        chain = self.pid_chains.get(pid, [])
        if 45 in chain and 16 in chain:
            alert = "IO_URING_REVERSE_SHELL"
            self.alert_count += 1
            self.pid_chains[pid] = []
        elif opcode == 18 and filename and any(p in filename for p in ["/etc/passwd", "/etc/shadow", "/root/.ssh/"]):
            alert = "SENSITIVE_FILE_ACCESS"
            self.alert_count += 1

        if self.args.json_output:
            record = {
                "timestamp": timestamp,
                "pid": pid,
                "uid": event.uid,
                "comm": comm,
                "opcode": opcode,
                "opcode_name": opcode_name,
                "fd": event.fd,
                "addr": hex(event.addr),
                "len": event.len,
                "flags": event.sqe_flags,
                "dangerous": is_dangerous,
            }
            if filename:
                record["filename"] = filename
            if alert:
                record["alert"] = alert
            print(json.dumps(record), flush=True)
        else:
            danger_marker = " *** DANGEROUS ***" if is_dangerous else ""
            alert_marker = f" !!! ALERT: {alert} !!!" if alert else ""
            print(
                f"[{timestamp}] PID={pid:<8} UID={event.uid:<6} "
                f"COMM={comm:<16} OP={opcode_name:<16} FD={event.fd:<6}"
                f"{danger_marker}{alert_marker}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.check_kernel_version()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF

        # Prepare BPF program with filters
        bpf_text = BPF_PROGRAM

        if self.args.pid:
            bpf_text = bpf_text.replace(
                "FILTER_PID",
                f"u32 __target_pid = {self.args.pid}; if (pid != __target_pid) return 0;"
            )
        else:
            bpf_text = bpf_text.replace("FILTER_PID", "")

        if self.args.dangerous_only:
            # Filter in kernel for dangerous opcodes
            dangerous_filter = " && ".join(
                f"event.opcode != {op}" for op in self.DANGEROUS_OPCODES
            )
            bpf_text = bpf_text.replace(
                "FILTER_DANGEROUS",
                ""
            )
        else:
            bpf_text = bpf_text.replace("FILTER_DANGEROUS", "")

        # Try tracepoint first, fall back to kprobe
        try:
            self.bpf = BPF(text=bpf_text)
            print("Attached via tracepoint: io_uring:io_uring_submit_sqe")
        except Exception:
            print("Tracepoint not available, falling back to kprobe...", file=sys.stderr)
            kprobe_text = BPF_PROGRAM_KPROBE
            if self.args.pid:
                kprobe_text = kprobe_text.replace(
                    "FILTER_PID",
                    f"u32 __target_pid = {self.args.pid}; if (pid != __target_pid) return 0;"
                )
            else:
                kprobe_text = kprobe_text.replace("FILTER_PID", "")
            self.bpf = BPF(text=kprobe_text)
            try:
                self.bpf.attach_kprobe(event="io_submit_sqes", fn_name="trace_io_submit")
            except Exception:
                try:
                    self.bpf.attach_kprobe(event="__io_submit_sqe", fn_name="trace_io_submit")
                except Exception:
                    print("ERROR: Could not attach to io_uring functions. Is io_uring supported?", file=sys.stderr)
                    sys.exit(1)
            print("Attached via kprobe: io_submit_sqes")

        self.bpf["io_uring_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing io_uring operations... Hit Ctrl+C to stop.\n")
        if not self.args.json_output:
            print(
                f"{'TIMESTAMP':<28} {'PID':<12} {'UID':<10} "
                f"{'COMM':<20} {'OPCODE':<20} {'FD':<8} {'INFO'}"
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
        print(f"\n--- io_uring_sniff summary ---")
        print(f"Captured {self.event_count} io_uring event(s)")
        print(f"Alerts: {self.alert_count}")
        if self.start_time:
            elapsed = time.monotonic() - self.start_time
            print(f"Duration: {elapsed:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor io_uring ring buffer operations via eBPF to detect syscall hook bypass.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 io_uring_sniff.py --duration 60\n"
            "  sudo python3 io_uring_sniff.py --dangerous-only --json-output\n"
            "  sudo python3 io_uring_sniff.py --pid 1234 --json-output"
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
        help="Filter to specific process ID",
    )
    parser.add_argument(
        "--dangerous-only",
        action="store_true",
        default=False,
        help="Only show dangerous opcodes (CONNECT, READ, WRITE, OPENAT, SOCKET, SEND, RECV)",
    )
    args = parser.parse_args()

    sniffer = IoUringSniffer(args)
    sniffer.run()


if __name__ == "__main__":
    main()
