#!/usr/bin/env python3
"""
bpfmap_sniff.py - Monitor BPF map operations via eBPF.

Attaches to syscalls:sys_enter_bpf tracepoint filtered to map operations
(MAP_UPDATE_ELEM, MAP_LOOKUP_ELEM, MAP_DELETE_ELEM, MAP_CREATE) to detect
covert channels that use BPF maps for inter-process data sharing.
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

BPF_PROGRAM = r"""
#include <uapi/linux/ptrace.h>
#include <linux/sched.h>

struct bpfmap_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u32 cmd;            // BPF command (MAP_CREATE=0, LOOKUP=1, UPDATE=2, DELETE=3)
    u32 map_fd;         // map file descriptor
    u32 map_type;       // BPF_MAP_TYPE_HASH=1, ARRAY=2, etc.
    u32 key_size;
    u32 value_size;
    u32 max_entries;
    u64 flags;          // BPF_ANY=0, BPF_NOEXIST=1, BPF_EXIST=2
    char comm[TASK_COMM_LEN];
};

BPF_PERF_OUTPUT(bpfmap_events);

TRACEPOINT_PROBE(syscalls, sys_enter_bpf) {
    u32 cmd = (u32)args->cmd;

    // Only capture map operations
    // MAP_CREATE=0, MAP_LOOKUP_ELEM=1, MAP_UPDATE_ELEM=2,
    // MAP_DELETE_ELEM=3, MAP_GET_NEXT_KEY=4
    if (cmd > 4)
        return 0;

    struct bpfmap_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.cmd = cmd;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    // Read bpf_attr fields from userspace
    if (cmd == 0) {
        // MAP_CREATE: map_type at offset 0, key_size at 4, value_size at 8, max_entries at 12
        bpf_probe_read_user(&event.map_type, sizeof(event.map_type), (void *)args->uattr);
        bpf_probe_read_user(&event.key_size, sizeof(event.key_size), (void *)(args->uattr + 4));
        bpf_probe_read_user(&event.value_size, sizeof(event.value_size), (void *)(args->uattr + 8));
        bpf_probe_read_user(&event.max_entries, sizeof(event.max_entries), (void *)(args->uattr + 12));
    } else {
        // LOOKUP/UPDATE/DELETE: map_fd at offset 0, flags at offset 16
        bpf_probe_read_user(&event.map_fd, sizeof(event.map_fd), (void *)args->uattr);
        bpf_probe_read_user(&event.flags, sizeof(event.flags), (void *)(args->uattr + 16));
    }

    bpfmap_events.perf_submit(args, &event, sizeof(event));
    return 0;
}
"""


class BpfmapEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("cmd", ctypes.c_uint32),
        ("map_fd", ctypes.c_uint32),
        ("map_type", ctypes.c_uint32),
        ("key_size", ctypes.c_uint32),
        ("value_size", ctypes.c_uint32),
        ("max_entries", ctypes.c_uint32),
        ("flags", ctypes.c_uint64),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
    ]


class BpfmapSniffer:
    BPF_CMDS = {
        0: "MAP_CREATE", 1: "MAP_LOOKUP_ELEM", 2: "MAP_UPDATE_ELEM",
        3: "MAP_DELETE_ELEM", 4: "MAP_GET_NEXT_KEY",
    }

    MAP_TYPES = {
        0: "UNSPEC", 1: "HASH", 2: "ARRAY", 3: "PROG_ARRAY",
        4: "PERF_EVENT_ARRAY", 5: "PERCPU_HASH", 6: "PERCPU_ARRAY",
        7: "STACK_TRACE", 8: "CGROUP_ARRAY", 9: "LRU_HASH",
        10: "LRU_PERCPU_HASH", 11: "LPM_TRIE", 12: "ARRAY_OF_MAPS",
        13: "HASH_OF_MAPS", 14: "DEVMAP", 15: "SOCKMAP",
        16: "CPUMAP", 17: "XSKMAP", 18: "SOCKHASH",
        19: "CGROUP_STORAGE", 20: "REUSEPORT_SOCKARRAY",
        21: "PERCPU_CGROUP_STORAGE", 22: "QUEUE", 23: "STACK",
        24: "SK_STORAGE", 25: "DEVMAP_HASH", 26: "STRUCT_OPS",
        27: "RINGBUF", 28: "INODE_STORAGE", 29: "TASK_STORAGE",
    }

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.alert_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None
        self.map_ops = {}  # pid -> {create: N, update: N, lookup: N, delete: N}
        self.maps_created = {}  # pid -> [{type, key_size, value_size, max_entries}]

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: bpfmap_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  bpfmap_sniff.py - BPF Map Covert Channel Monitor (eBPF)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Hooks:       bpf() MAP_CREATE/LOOKUP/UPDATE/DELETE")
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
        event = ctypes.cast(data, ctypes.POINTER(BpfmapEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        pid = event.pid
        cmd = event.cmd
        cmd_name = self.BPF_CMDS.get(cmd, f"CMD({cmd})")

        # Track operations per PID
        if pid not in self.map_ops:
            self.map_ops[pid] = {"create": 0, "update": 0, "lookup": 0, "delete": 0}
        if cmd == 0:
            self.map_ops[pid]["create"] += 1
        elif cmd == 1:
            self.map_ops[pid]["lookup"] += 1
        elif cmd == 2:
            self.map_ops[pid]["update"] += 1
        elif cmd == 3:
            self.map_ops[pid]["delete"] += 1

        alert = None
        severity = "info"

        if cmd == 0:  # MAP_CREATE
            map_type_name = self.MAP_TYPES.get(event.map_type, f"TYPE({event.map_type})")

            # Track created maps
            if pid not in self.maps_created:
                self.maps_created[pid] = []
            self.maps_created[pid].append({
                "type": map_type_name,
                "key_size": event.key_size,
                "value_size": event.value_size,
                "max_entries": event.max_entries,
            })

            # Large value maps = potential data exfil channel
            if event.value_size > 4096:
                alert = "LARGE_VALUE_BPF_MAP"
                severity = "warning"
                self.alert_count += 1

            # RINGBUF or QUEUE maps = potential covert channel
            if event.map_type in (22, 23, 27):  # QUEUE, STACK, RINGBUF
                alert = "COVERT_CHANNEL_MAP_TYPE"
                severity = "warning"
                self.alert_count += 1

        elif cmd == 2:  # MAP_UPDATE_ELEM
            # High-frequency updates = active covert channel
            if self.map_ops[pid]["update"] > 100:
                alert = "HIGH_FREQ_MAP_UPDATES"
                severity = "critical"
                self.alert_count += 1

        if alert and not self.args.json_output:
            print(
                f"\n{'!'*70}\n"
                f"  !!! {alert} !!!\n"
                f"  PID={pid} COMM={comm}\n"
                f"  CMD={cmd_name}",
                end="", flush=True,
            )
            if cmd == 0:
                print(
                    f" MAP_TYPE={self.MAP_TYPES.get(event.map_type, '?')}"
                    f" KEY={event.key_size} VAL={event.value_size}"
                    f" MAX={event.max_entries}",
                    end="",
                )
            print(f"\n{'!'*70}\n", flush=True)

        if self.args.json_output:
            record = {
                "timestamp": timestamp, "pid": pid, "uid": event.uid,
                "comm": comm, "cmd": cmd_name, "severity": severity,
            }
            if cmd == 0:
                record["map_type"] = self.MAP_TYPES.get(event.map_type, str(event.map_type))
                record["key_size"] = event.key_size
                record["value_size"] = event.value_size
                record["max_entries"] = event.max_entries
            else:
                record["map_fd"] = event.map_fd
                record["flags"] = hex(event.flags)
            if alert:
                record["alert"] = alert
            print(json.dumps(record), flush=True)
        elif not alert:
            extra = ""
            if cmd == 0:
                extra = (f" TYPE={self.MAP_TYPES.get(event.map_type, '?')}"
                         f" KEY={event.key_size} VAL={event.value_size}"
                         f" MAX={event.max_entries}")
            else:
                extra = f" FD={event.map_fd}"
            print(
                f"[{timestamp}] PID={pid:<8} UID={event.uid:<6} "
                f"COMM={comm:<16} CMD={cmd_name:<20}{extra}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.print_banner()
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF
        self.bpf = BPF(text=BPF_PROGRAM)
        self.bpf["bpfmap_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing BPF map operations... Hit Ctrl+C to stop.\n")
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
        print(f"\n--- bpfmap_sniff summary ---")
        print(f"Captured {self.event_count} event(s), Alerts: {self.alert_count}")
        if self.maps_created:
            print(f"PIDs creating BPF maps: {list(self.maps_created.keys())}")
            for pid, maps in self.maps_created.items():
                print(f"  PID {pid}: {len(maps)} map(s) created")
        if self.map_ops:
            for pid, ops in self.map_ops.items():
                if ops["update"] > 0 or ops["create"] > 0:
                    print(f"  PID {pid}: create={ops['create']} update={ops['update']} lookup={ops['lookup']} delete={ops['delete']}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor BPF map operations for covert channel detection via eBPF.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n  sudo python3 bpfmap_sniff.py --duration 60\n  sudo python3 bpfmap_sniff.py --json-output",
    )
    parser.add_argument("--json-output", action="store_true", default=False)
    parser.add_argument("--duration", type=int, default=None, metavar="SECONDS")
    args = parser.parse_args()
    BpfmapSniffer(args).run()


if __name__ == "__main__":
    main()
