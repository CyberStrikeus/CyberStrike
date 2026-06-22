#!/usr/bin/env python3
"""
execve_sniff.py - Capture all process executions via eBPF tracepoint.

Attaches to the syscalls:sys_enter_execve tracepoint to intercept every
execve() call on the system. Captures PID, PPID, UID, command name,
filename, and the first 5 arguments. Requires root privileges.

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
MAX_ARG_LEN = 128
MAX_ARGS = 5
MAX_FILENAME_LEN = 256

BPF_PROGRAM = r"""
#include <uapi/linux/ptrace.h>
#include <linux/sched.h>
#include <linux/fs.h>

#define MAX_ARG_LEN     128
#define MAX_ARGS        5
#define MAX_FILENAME_LEN 256

struct execve_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 ppid;
    u32 uid;
    u32 gid;
    char comm[TASK_COMM_LEN];
    char filename[MAX_FILENAME_LEN];
    char argv[MAX_ARGS][MAX_ARG_LEN];
    u8  argc;    // number of args captured (0..MAX_ARGS)
};

BPF_PERF_OUTPUT(execve_events);

// Tracepoint: syscalls/sys_enter_execve
// args: const char __user *filename, const char __user *const __user *argv,
//       const char __user *const __user *envp
TRACEPOINT_PROBE(syscalls, sys_enter_execve) {
    struct execve_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();

    u64 pid_tgid = bpf_get_current_pid_tgid();
    event.pid = pid_tgid >> 32;

    struct task_struct *task = (struct task_struct *)bpf_get_current_task();
    event.ppid = task->real_parent->tgid;

    u64 uid_gid = bpf_get_current_uid_gid();
    event.uid = (u32)uid_gid;
    event.gid = (u32)(uid_gid >> 32);

    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    // Read the filename from the tracepoint args
    bpf_probe_read_user_str(&event.filename, sizeof(event.filename),
                            (const char *)args->filename);

    // Read up to MAX_ARGS from argv
    const char __user *const __user *argv_ptr =
        (const char __user *const __user *)args->argv;

    event.argc = 0;

    #pragma unroll
    for (int i = 0; i < MAX_ARGS; i++) {
        const char *arg = NULL;
        int ret = bpf_probe_read_user(&arg, sizeof(arg), &argv_ptr[i]);
        if (ret != 0 || arg == NULL)
            break;
        ret = bpf_probe_read_user_str(&event.argv[i], MAX_ARG_LEN, arg);
        if (ret <= 0)
            break;
        event.argc = i + 1;
    }

    execve_events.perf_submit(args, &event, sizeof(event));
    return 0;
}
"""


class ExecveEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("ppid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("gid", ctypes.c_uint32),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
        ("filename", ctypes.c_char * MAX_FILENAME_LEN),
        ("argv", (ctypes.c_char * MAX_ARG_LEN) * MAX_ARGS),
        ("argc", ctypes.c_uint8),
    ]


class ExecveSniffer:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: execve_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  execve_sniff.py - Process Execution Tracer (eBPF)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Tracepoint:  syscalls:sys_enter_execve")
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
        event = ctypes.cast(data, ctypes.POINTER(ExecveEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        filename = event.filename.decode("utf-8", errors="replace").rstrip("\x00")

        # Extract argv
        argv_list = []
        for i in range(min(event.argc, MAX_ARGS)):
            arg = event.argv[i].value.decode("utf-8", errors="replace").rstrip("\x00")
            if arg:
                argv_list.append(arg)

        if self.args.json_output:
            record = {
                "timestamp": timestamp,
                "pid": event.pid,
                "ppid": event.ppid,
                "uid": event.uid,
                "gid": event.gid,
                "comm": comm,
                "filename": filename,
                "argv": argv_list,
            }
            print(json.dumps(record), flush=True)
        else:
            argv_str = " ".join(argv_list) if argv_list else filename
            print(
                f"[{timestamp}] PID={event.pid:<8} PPID={event.ppid:<8} "
                f"UID={event.uid:<6} COMM={comm:<16} "
                f"CMD={argv_str}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF

        self.bpf = BPF(text=BPF_PROGRAM)

        # The tracepoint is attached automatically via TRACEPOINT_PROBE macro
        self.bpf["execve_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing process executions... Hit Ctrl+C to stop.\n")
        if not self.args.json_output:
            print(
                f"{'TIMESTAMP':<28} {'PID':<12} {'PPID':<12} "
                f"{'UID':<10} {'COMM':<20} {'CMD'}"
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
        print(f"\n--- execve_sniff summary ---")
        print(f"Captured {self.event_count} execve event(s)")
        if self.start_time:
            elapsed = time.monotonic() - self.start_time
            print(f"Duration: {elapsed:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Trace all process executions (execve) via eBPF tracepoint.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 execve_sniff.py\n"
            "  sudo python3 execve_sniff.py --json-output --duration 120\n"
            "  sudo python3 execve_sniff.py --json-output | jq '.'"
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

    sniffer = ExecveSniffer(args)
    sniffer.run()


if __name__ == "__main__":
    main()
