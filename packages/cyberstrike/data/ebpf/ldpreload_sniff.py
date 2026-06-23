#!/usr/bin/env python3
"""
ldpreload_sniff.py - Monitor LD_PRELOAD and dynamic linker injection via eBPF.

Attaches to syscalls:sys_enter_execve and sys_enter_openat tracepoints
to detect LD_PRELOAD environment variable injection and suspicious
dynamic linker configuration file modifications. Requires root privileges.

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
MAX_ENV_LEN = 256

BPF_PROGRAM = r"""
#include <uapi/linux/ptrace.h>
#include <linux/sched.h>

#define MAX_PATH_LEN 256
#define MAX_ENV_LEN 256

struct ldpreload_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u8  event_type;     // 0=execve_with_env, 1=openat_ld_conf, 2=openat_ld_preload_file
    char comm[TASK_COMM_LEN];
    char filename[MAX_PATH_LEN];
    char env_value[MAX_ENV_LEN];  // LD_PRELOAD value if detected
};

BPF_PERF_OUTPUT(ldpreload_events);

// Monitor openat for ld.so.preload and ld.so.conf modifications
TRACEPOINT_PROBE(syscalls, sys_enter_openat) {
    char filename[MAX_PATH_LEN] = {};
    bpf_probe_read_user_str(filename, sizeof(filename), (const char *)args->filename);

    // Check for /etc/ld.so.preload
    int is_preload = 0;
    if (filename[0] == '/' && filename[1] == 'e' && filename[2] == 't' &&
        filename[3] == 'c' && filename[4] == '/' && filename[5] == 'l' &&
        filename[6] == 'd' && filename[7] == '.' && filename[8] == 's' &&
        filename[9] == 'o' && filename[10] == '.') {
        // Check for "preload" or "conf"
        if (filename[11] == 'p') is_preload = 1;  // ld.so.preload
        if (filename[11] == 'c') is_preload = 2;  // ld.so.conf
    }

    if (!is_preload) return 0;

    // Only alert on write access (O_WRONLY=1, O_RDWR=2, O_CREAT=0x40, O_TRUNC=0x200)
    u32 flags = (u32)args->flags;
    if (!(flags & 0x01) && !(flags & 0x02) && !(flags & 0x40))
        return 0;

    struct ldpreload_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = (is_preload == 1) ? 2 : 1;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));
    __builtin_memcpy(&event.filename, filename, MAX_PATH_LEN);

    ldpreload_events.perf_submit(args, &event, sizeof(event));
    return 0;
}

// Monitor execve for LD_PRELOAD in environment
TRACEPOINT_PROBE(syscalls, sys_enter_execve) {
    // Read argv[0] as filename
    const char **argv = (const char **)args->argv;
    const char **envp = (const char **)args->envp;

    struct ldpreload_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 0;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));
    bpf_probe_read_user_str(&event.filename, sizeof(event.filename), (const char *)args->filename);

    // Scan first 32 environment variables for LD_PRELOAD
    if (!envp) return 0;

    #pragma unroll
    for (int i = 0; i < 32; i++) {
        const char *env_entry = NULL;
        bpf_probe_read_user(&env_entry, sizeof(env_entry), &envp[i]);
        if (!env_entry) break;

        char env_buf[16] = {};
        bpf_probe_read_user_str(env_buf, sizeof(env_buf), env_entry);

        // Check for "LD_PRELOAD=" prefix
        if (env_buf[0] == 'L' && env_buf[1] == 'D' && env_buf[2] == '_' &&
            env_buf[3] == 'P' && env_buf[4] == 'R' && env_buf[5] == 'E' &&
            env_buf[6] == 'L' && env_buf[7] == 'O' && env_buf[8] == 'A' &&
            env_buf[9] == 'D' && env_buf[10] == '=') {
            bpf_probe_read_user_str(&event.env_value, sizeof(event.env_value), env_entry);
            ldpreload_events.perf_submit(args, &event, sizeof(event));
            return 0;
        }

        // Check for "LD_LIBRARY_PATH=" prefix
        if (env_buf[0] == 'L' && env_buf[1] == 'D' && env_buf[2] == '_' &&
            env_buf[3] == 'L' && env_buf[4] == 'I' && env_buf[5] == 'B') {
            bpf_probe_read_user_str(&event.env_value, sizeof(event.env_value), env_entry);
            ldpreload_events.perf_submit(args, &event, sizeof(event));
            return 0;
        }
    }

    return 0;
}
"""


class LdpreloadEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("event_type", ctypes.c_uint8),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
        ("filename", ctypes.c_char * MAX_PATH_LEN),
        ("env_value", ctypes.c_char * MAX_ENV_LEN),
    ]


class LdpreloadSniffer:
    EVENT_TYPES = {0: "execve_ld_env", 1: "open_ld_conf", 2: "open_ld_preload"}

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.alert_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None
        self.ld_preload_pids = {}  # pid -> [{filename, env_value, time}]

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: ldpreload_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  ldpreload_sniff.py - LD_PRELOAD / Dynamic Linker Monitor (eBPF)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Hooks:       execve (env scan) + openat (ld.so.preload/conf)")
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
        event = ctypes.cast(data, ctypes.POINTER(LdpreloadEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        filename = event.filename.decode("utf-8", errors="replace").rstrip("\x00")
        env_value = event.env_value.decode("utf-8", errors="replace").rstrip("\x00")
        pid = event.pid
        event_name = self.EVENT_TYPES.get(event.event_type, "unknown")

        alert = None
        severity = "info"

        if event.event_type == 0:  # execve with LD_PRELOAD
            alert = "LD_PRELOAD_INJECTION"
            severity = "critical"
            self.alert_count += 1

            if pid not in self.ld_preload_pids:
                self.ld_preload_pids[pid] = []
            self.ld_preload_pids[pid].append({
                "filename": filename,
                "env_value": env_value,
                "time": timestamp,
            })

        elif event.event_type == 1:  # ld.so.conf write
            alert = "LD_CONF_MODIFICATION"
            severity = "critical"
            self.alert_count += 1

        elif event.event_type == 2:  # ld.so.preload write
            alert = "LD_SO_PRELOAD_MODIFICATION"
            severity = "critical"
            self.alert_count += 1

        if alert and not self.args.json_output:
            print(
                f"\n{'!'*70}\n"
                f"  !!! {alert} !!!\n"
                f"  PID={pid} COMM={comm}\n"
                f"  FILE={filename}",
                end="", flush=True,
            )
            if env_value:
                print(f"\n  ENV={env_value}", end="")
            print(f"\n{'!'*70}\n", flush=True)

        if self.args.json_output:
            record = {
                "timestamp": timestamp, "pid": pid, "uid": event.uid,
                "comm": comm, "event_type": event_name,
                "filename": filename, "severity": severity,
            }
            if env_value:
                record["env_value"] = env_value
            if alert:
                record["alert"] = alert
            print(json.dumps(record), flush=True)
        elif not alert:
            extra = f" ENV={env_value}" if env_value else ""
            print(
                f"[{timestamp}] PID={pid:<8} UID={event.uid:<6} "
                f"COMM={comm:<16} TYPE={event_name:<20} "
                f"FILE={filename}{extra}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.print_banner()
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF
        self.bpf = BPF(text=BPF_PROGRAM)
        self.bpf["ldpreload_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing LD_PRELOAD / dynamic linker operations... Hit Ctrl+C to stop.\n")
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
        print(f"\n--- ldpreload_sniff summary ---")
        print(f"Captured {self.event_count} event(s), Alerts: {self.alert_count}")
        if self.ld_preload_pids:
            print(f"PIDs using LD_PRELOAD: {list(self.ld_preload_pids.keys())}")
            for pid, entries in self.ld_preload_pids.items():
                for entry in entries:
                    print(f"  PID {pid}: {entry['env_value']}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor LD_PRELOAD injection and dynamic linker configuration changes via eBPF.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n  sudo python3 ldpreload_sniff.py --duration 60\n  sudo python3 ldpreload_sniff.py --json-output",
    )
    parser.add_argument("--json-output", action="store_true", default=False)
    parser.add_argument("--duration", type=int, default=None, metavar="SECONDS")
    args = parser.parse_args()
    LdpreloadSniffer(args).run()


if __name__ == "__main__":
    main()
