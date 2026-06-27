#!/usr/bin/env python3
"""
keyring_sniff.py - Monitor kernel keyring operations via eBPF.

Attaches to syscalls:sys_enter_add_key, sys_enter_keyctl, and
sys_enter_request_key tracepoints to detect credential storage in the
kernel keyring. Attackers may store stolen credentials in the keyring
instead of files to evade filesystem monitoring. Requires root privileges.

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
MAX_TYPE_LEN = 32
MAX_DESC_LEN = 128

BPF_PROGRAM = r"""
#include <uapi/linux/ptrace.h>
#include <linux/sched.h>

#define MAX_TYPE_LEN 32
#define MAX_DESC_LEN 128

struct keyring_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u8  event_type;     // 0=add_key, 1=keyctl, 2=request_key
    u32 keyctl_cmd;
    u64 key_serial;
    u64 payload_len;
    char comm[TASK_COMM_LEN];
    char key_type[MAX_TYPE_LEN];
    char description[MAX_DESC_LEN];
};

BPF_PERF_OUTPUT(keyring_events);

TRACEPOINT_PROBE(syscalls, sys_enter_add_key) {
    struct keyring_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 0;
    event.payload_len = (u64)args->plen;
    event.key_serial = (u64)args->ringid;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));
    bpf_probe_read_user_str(&event.key_type, sizeof(event.key_type), (const char *)args->_type);
    bpf_probe_read_user_str(&event.description, sizeof(event.description), (const char *)args->_description);

    keyring_events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_keyctl) {
    struct keyring_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 1;
    event.keyctl_cmd = (u32)args->option;
    event.key_serial = (u64)args->arg2;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    keyring_events.perf_submit(args, &event, sizeof(event));
    return 0;
}

TRACEPOINT_PROBE(syscalls, sys_enter_request_key) {
    struct keyring_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.event_type = 2;
    event.key_serial = (u64)args->destringid;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));
    bpf_probe_read_user_str(&event.key_type, sizeof(event.key_type), (const char *)args->_type);
    bpf_probe_read_user_str(&event.description, sizeof(event.description), (const char *)args->_description);

    keyring_events.perf_submit(args, &event, sizeof(event));
    return 0;
}
"""


class KeyringEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("event_type", ctypes.c_uint8),
        ("keyctl_cmd", ctypes.c_uint32),
        ("key_serial", ctypes.c_uint64),
        ("payload_len", ctypes.c_uint64),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
        ("key_type", ctypes.c_char * MAX_TYPE_LEN),
        ("description", ctypes.c_char * MAX_DESC_LEN),
    ]


class KeyringSniffer:
    EVENT_TYPES = {0: "add_key", 1: "keyctl", 2: "request_key"}
    KEYCTL_CMDS = {
        0: "GET_KEYRING_ID", 1: "JOIN_SESSION_KEYRING", 2: "UPDATE",
        3: "REVOKE", 4: "CHOWN", 5: "SETPERM", 6: "DESCRIBE",
        7: "CLEAR", 8: "LINK", 9: "UNLINK", 10: "SEARCH",
        11: "READ", 12: "INSTANTIATE", 13: "NEGATE", 14: "SET_REQKEY_KEYRING",
        15: "SET_TIMEOUT", 16: "ASSUME_AUTHORITY", 17: "GET_SECURITY",
        23: "SESSION_TO_PARENT", 28: "INVALIDATE", 29: "GET_PERSISTENT",
    }
    SUSPICIOUS_TYPES = {"user", "logon", "big_key", "encrypted"}

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.alert_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: keyring_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  keyring_sniff.py - Kernel Keyring Monitor (eBPF)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Hooks:       add_key + keyctl + request_key")
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
        event = ctypes.cast(data, ctypes.POINTER(KeyringEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        key_type = event.key_type.decode("utf-8", errors="replace").rstrip("\x00")
        desc = event.description.decode("utf-8", errors="replace").rstrip("\x00")
        event_name = self.EVENT_TYPES.get(event.event_type, "unknown")

        alert = None
        severity = "info"

        if event.event_type == 0:  # add_key
            if key_type in self.SUSPICIOUS_TYPES:
                alert = "CREDENTIAL_STORED_IN_KEYRING"
                severity = "warning"
                self.alert_count += 1
            if event.payload_len > 4096:
                alert = "LARGE_KEYRING_PAYLOAD"
                severity = "warning"
                self.alert_count += 1

        elif event.event_type == 1:  # keyctl
            cmd = event.keyctl_cmd
            cmd_name = self.KEYCTL_CMDS.get(cmd, f"UNKNOWN({cmd})")
            if cmd == 11:  # READ
                alert = "KEYRING_READ"
                severity = "info"
            elif cmd == 2:  # UPDATE
                alert = "KEYRING_UPDATE"
                severity = "warning"
                self.alert_count += 1

        if self.args.json_output:
            record = {
                "timestamp": timestamp, "pid": event.pid, "uid": event.uid,
                "comm": comm, "event_type": event_name, "severity": severity,
            }
            if event.event_type == 0:
                record["key_type"] = key_type
                record["description"] = desc
                record["payload_len"] = event.payload_len
            elif event.event_type == 1:
                record["keyctl_cmd"] = self.KEYCTL_CMDS.get(event.keyctl_cmd, str(event.keyctl_cmd))
                record["key_serial"] = event.key_serial
            elif event.event_type == 2:
                record["key_type"] = key_type
                record["description"] = desc
            if alert:
                record["alert"] = alert
            print(json.dumps(record), flush=True)
        else:
            alert_str = f" !!! {alert} !!!" if alert else ""
            extra = ""
            if event.event_type == 0:
                extra = f" TYPE={key_type} DESC={desc} LEN={event.payload_len}"
            elif event.event_type == 1:
                extra = f" CMD={self.KEYCTL_CMDS.get(event.keyctl_cmd, '?')} KEY={event.key_serial}"
            elif event.event_type == 2:
                extra = f" TYPE={key_type} DESC={desc}"
            print(
                f"[{timestamp}] PID={event.pid:<8} UID={event.uid:<6} "
                f"COMM={comm:<16} EVT={event_name:<12}{extra}{alert_str}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.print_banner()
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF
        self.bpf = BPF(text=BPF_PROGRAM)
        self.bpf["keyring_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing kernel keyring operations... Hit Ctrl+C to stop.\n")
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
        print(f"\n--- keyring_sniff summary ---")
        print(f"Captured {self.event_count} event(s), Alerts: {self.alert_count}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor kernel keyring operations (add_key/keyctl/request_key) via eBPF.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n  sudo python3 keyring_sniff.py --duration 60\n  sudo python3 keyring_sniff.py --json-output",
    )
    parser.add_argument("--json-output", action="store_true", default=False)
    parser.add_argument("--duration", type=int, default=None, metavar="SECONDS")
    args = parser.parse_args()
    KeyringSniffer(args).run()


if __name__ == "__main__":
    main()
