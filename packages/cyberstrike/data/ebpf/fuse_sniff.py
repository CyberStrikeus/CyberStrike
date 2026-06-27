#!/usr/bin/env python3
"""
fuse_sniff.py - Monitor FUSE filesystem operations via eBPF.

Detects userspace filesystem mounting by monitoring /dev/fuse opens and
FUSE-type mount operations. When an attacker mounts a FUSE filesystem,
file operations bypass kernel VFS and run in the attacker's code.
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
MAX_PATH_LEN = 256

BPF_PROGRAM = r"""
#include <uapi/linux/ptrace.h>
#include <linux/sched.h>

#define MAX_PATH_LEN 256

struct fuse_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u8  event_type;     // 0=open_dev_fuse, 1=fuse_mount
    u32 fd;
    u32 flags;
    char comm[TASK_COMM_LEN];
    char path[MAX_PATH_LEN];
    char mountpoint[MAX_PATH_LEN];
};

BPF_PERF_OUTPUT(fuse_events);

TRACEPOINT_PROBE(syscalls, sys_enter_openat) {
    char filename[MAX_PATH_LEN] = {};
    bpf_probe_read_user_str(filename, sizeof(filename), (const char *)args->filename);

    // Only capture /dev/fuse opens
    if (filename[0] != '/' || filename[1] != 'd' || filename[2] != 'e' ||
        filename[3] != 'v' || filename[4] != '/' || filename[5] != 'f' ||
        filename[6] != 'u' || filename[7] != 's' || filename[8] != 'e' ||
        filename[9] != '\0')
        return 0;

    struct fuse_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 0;
    event.flags = (u32)args->flags;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));
    __builtin_memcpy(&event.path, filename, MAX_PATH_LEN);

    fuse_events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_mount) {
    char fs_type[32] = {};
    bpf_probe_read_user_str(fs_type, sizeof(fs_type), (const char *)args->type);

    // Check for fuse* filesystem types
    if (fs_type[0] != 'f' || fs_type[1] != 'u' || fs_type[2] != 's' || fs_type[3] != 'e')
        return 0;

    struct fuse_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 1;
    event.flags = (u32)args->flags;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));
    bpf_probe_read_user_str(&event.path, sizeof(event.path), (const char *)args->dev_name);
    bpf_probe_read_user_str(&event.mountpoint, sizeof(event.mountpoint), (const char *)args->dir_name);

    fuse_events.perf_submit(args, &event, sizeof(event));
    return 0;
}
"""


class FuseEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("event_type", ctypes.c_uint8),
        ("fd", ctypes.c_uint32),
        ("flags", ctypes.c_uint32),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
        ("path", ctypes.c_char * MAX_PATH_LEN),
        ("mountpoint", ctypes.c_char * MAX_PATH_LEN),
    ]


class FuseSniffer:
    EVENT_TYPES = {0: "open_dev_fuse", 1: "fuse_mount"}

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.alert_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None
        self.fuse_pids = {}

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: fuse_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  fuse_sniff.py - FUSE Filesystem Monitor (eBPF)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Hooks:       openat(/dev/fuse) + mount(fuse*)")
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
        event = ctypes.cast(data, ctypes.POINTER(FuseEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        path = event.path.decode("utf-8", errors="replace").rstrip("\x00")
        mountpoint = event.mountpoint.decode("utf-8", errors="replace").rstrip("\x00")
        event_name = self.EVENT_TYPES.get(event.event_type, "unknown")
        pid = event.pid

        alert = None
        severity = "warning"

        if event.event_type == 0:
            alert = "DEV_FUSE_OPENED"
            self.alert_count += 1
            self.fuse_pids[pid] = {"comm": comm, "time": timestamp}

        elif event.event_type == 1:
            alert = "FUSE_FILESYSTEM_MOUNTED"
            severity = "critical"
            self.alert_count += 1

        if not self.args.json_output and alert:
            print(
                f"\n{'!'*70}\n"
                f"  !!! {alert} !!!\n"
                f"  PID={pid} COMM={comm}\n"
                f"  PATH={path}",
                end="", flush=True,
            )
            if mountpoint:
                print(f" MOUNTPOINT={mountpoint}", end="")
            print(f"\n{'!'*70}\n", flush=True)

        if self.args.json_output:
            record = {
                "timestamp": timestamp, "pid": pid, "uid": event.uid,
                "comm": comm, "event_type": event_name, "path": path,
                "severity": severity,
            }
            if mountpoint:
                record["mountpoint"] = mountpoint
            if alert:
                record["alert"] = alert
            print(json.dumps(record), flush=True)

    def run(self):
        self.check_root()
        self.print_banner()
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF
        self.bpf = BPF(text=BPF_PROGRAM)
        self.bpf["fuse_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing FUSE operations... Hit Ctrl+C to stop.\n")
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
        print(f"\n--- fuse_sniff summary ---")
        print(f"Captured {self.event_count} event(s), Alerts: {self.alert_count}")
        if self.fuse_pids:
            print(f"PIDs that opened /dev/fuse: {list(self.fuse_pids.keys())}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor FUSE filesystem operations (/dev/fuse opens and fuse mounts) via eBPF.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n  sudo python3 fuse_sniff.py --duration 60\n  sudo python3 fuse_sniff.py --json-output",
    )
    parser.add_argument("--json-output", action="store_true", default=False)
    parser.add_argument("--duration", type=int, default=None, metavar="SECONDS")
    args = parser.parse_args()
    FuseSniffer(args).run()


if __name__ == "__main__":
    main()
