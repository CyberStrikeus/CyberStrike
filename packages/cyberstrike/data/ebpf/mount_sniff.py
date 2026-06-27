#!/usr/bin/env python3
"""
mount_sniff.py - Monitor mount operations via eBPF.

Attaches to syscalls:sys_enter_mount and sys_enter_umount2 tracepoints
to detect overlay mounts, bind mounts over sensitive paths, and filesystem
manipulation used to hide changes. Requires root privileges.

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
MAX_TYPE_LEN = 32

BPF_PROGRAM = r"""
#include <uapi/linux/ptrace.h>
#include <linux/sched.h>

#define MAX_PATH_LEN 256
#define MAX_TYPE_LEN 32

struct mount_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u8  event_type;     // 0=mount, 1=umount
    u32 flags;
    char comm[TASK_COMM_LEN];
    char source[MAX_PATH_LEN];
    char target[MAX_PATH_LEN];
    char fs_type[MAX_TYPE_LEN];
};

BPF_PERF_OUTPUT(mount_events);

TRACEPOINT_PROBE(syscalls, sys_enter_mount) {
    struct mount_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 0;
    event.flags = (u32)args->flags;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));
    bpf_probe_read_user_str(&event.source, sizeof(event.source), (const char *)args->dev_name);
    bpf_probe_read_user_str(&event.target, sizeof(event.target), (const char *)args->dir_name);
    bpf_probe_read_user_str(&event.fs_type, sizeof(event.fs_type), (const char *)args->type);
    mount_events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_umount) {
    struct mount_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 1;
    event.flags = (u32)args->flags;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));
    bpf_probe_read_user_str(&event.target, sizeof(event.target), (const char *)args->name);
    mount_events.perf_submit(args, &event, sizeof(event));
    return 0;
}
"""

SENSITIVE_PATHS = {"/etc", "/usr", "/bin", "/sbin", "/lib", "/root", "/var/log",
                   "/proc", "/sys", "/dev", "/boot", "/home"}


class MountEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("event_type", ctypes.c_uint8),
        ("flags", ctypes.c_uint32),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
        ("source", ctypes.c_char * MAX_PATH_LEN),
        ("target", ctypes.c_char * MAX_PATH_LEN),
        ("fs_type", ctypes.c_char * MAX_TYPE_LEN),
    ]


class MountSniffer:
    EVENT_TYPES = {0: "mount", 1: "umount"}
    MS_BIND = 4096
    MS_MOVE = 8192
    MS_REC = 16384

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.alert_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: mount_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  mount_sniff.py - Mount Operation Monitor (eBPF)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Hooks:       mount + umount")
        print(f"  JSON output: {self.args.json_output}")
        if self.args.duration:
            print(f"  Duration:    {self.args.duration}s")
        else:
            print("  Duration:    unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    def _is_sensitive_target(self, target):
        for path in SENSITIVE_PATHS:
            if target == path or target.startswith(path + "/"):
                return True
        return False

    def handle_event(self, cpu, data, size):
        event = ctypes.cast(data, ctypes.POINTER(MountEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        source = event.source.decode("utf-8", errors="replace").rstrip("\x00")
        target = event.target.decode("utf-8", errors="replace").rstrip("\x00")
        fs_type = event.fs_type.decode("utf-8", errors="replace").rstrip("\x00")
        event_name = self.EVENT_TYPES.get(event.event_type, "unknown")

        alert = None
        severity = "info"

        if event.event_type == 0:  # mount
            is_overlay = fs_type == "overlay"
            is_bind = bool(event.flags & self.MS_BIND)
            is_fuse = fs_type.startswith("fuse")
            is_sensitive = self._is_sensitive_target(target)

            if is_overlay and is_sensitive:
                alert = "OVERLAY_ON_SENSITIVE_PATH"
                severity = "critical"
                self.alert_count += 1
            elif is_bind and is_sensitive:
                alert = "BIND_MOUNT_SENSITIVE_PATH"
                severity = "critical"
                self.alert_count += 1
            elif is_overlay:
                alert = "OVERLAY_MOUNT"
                severity = "warning"
                self.alert_count += 1
            elif is_fuse:
                alert = "FUSE_MOUNT"
                severity = "warning"
                self.alert_count += 1

        elif event.event_type == 1:  # umount
            if self._is_sensitive_target(target):
                alert = "UMOUNT_SENSITIVE_PATH"
                severity = "critical"
                self.alert_count += 1

        if alert and not self.args.json_output:
            print(
                f"\n{'!'*70}\n"
                f"  !!! {alert} !!!\n"
                f"  PID={event.pid} COMM={comm}\n"
                f"  SOURCE={source} TARGET={target} TYPE={fs_type}\n"
                f"{'!'*70}\n",
                flush=True,
            )

        if self.args.json_output:
            record = {
                "timestamp": timestamp, "pid": event.pid, "uid": event.uid,
                "comm": comm, "event_type": event_name, "source": source,
                "target": target, "fs_type": fs_type, "flags": event.flags,
                "severity": severity,
            }
            if alert:
                record["alert"] = alert
            print(json.dumps(record), flush=True)
        elif not alert:
            flags_parts = []
            if event.flags & self.MS_BIND: flags_parts.append("BIND")
            if event.flags & self.MS_MOVE: flags_parts.append("MOVE")
            flags_str = "|".join(flags_parts) if flags_parts else ""
            print(
                f"[{timestamp}] PID={event.pid:<8} COMM={comm:<16} "
                f"TYPE={event_name:<8} FS={fs_type:<12} "
                f"SRC={source} -> {target} {flags_str}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.print_banner()
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF
        self.bpf = BPF(text=BPF_PROGRAM)
        self.bpf["mount_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing mount operations... Hit Ctrl+C to stop.\n")
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
        print(f"\n--- mount_sniff summary ---")
        print(f"Captured {self.event_count} event(s), Alerts: {self.alert_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor mount/umount operations for overlay and bind mount attacks via eBPF.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n  sudo python3 mount_sniff.py --duration 60\n  sudo python3 mount_sniff.py --json-output",
    )
    parser.add_argument("--json-output", action="store_true", default=False)
    parser.add_argument("--duration", type=int, default=None, metavar="SECONDS")
    args = parser.parse_args()
    MountSniffer(args).run()


if __name__ == "__main__":
    main()
