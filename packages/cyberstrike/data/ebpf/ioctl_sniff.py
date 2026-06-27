#!/usr/bin/env python3
"""
ioctl_sniff.py - Monitor dangerous ioctl operations via eBPF.

Attaches to syscalls:sys_enter_ioctl tracepoint to detect TIOCSTI
(terminal keystroke injection) and other dangerous ioctl commands.
Most ADRs don't filter ioctls, making this a blind spot.
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

struct ioctl_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u32 fd;
    u32 cmd;
    u64 arg;
    u8  injected_char;
    char comm[TASK_COMM_LEN];
};

BPF_PERF_OUTPUT(ioctl_events);

TRACEPOINT_PROBE(syscalls, sys_enter_ioctl) {
    u32 cmd = (u32)args->cmd;

    // Filter to dangerous ioctls only
    // TIOCSTI=0x5412 (terminal inject), TIOCSWINSZ=0x5414,
    // TIOCLINUX=0x541C, TIOCSCTTY=0x540E (steal controlling terminal)
    // FIONBIO=0x5421, TCSETS=0x5402 (terminal settings)
    if (cmd != 0x5412 && cmd != 0x541C && cmd != 0x540E &&
        cmd != 0x5414 && cmd != 0x5421 && cmd != 0x5402)
        return 0;

    struct ioctl_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.fd = (u32)args->fd;
    event.cmd = cmd;
    event.arg = (u64)args->arg;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    // For TIOCSTI, read the injected character
    if (cmd == 0x5412) {
        u8 ch = 0;
        bpf_probe_read_user(&ch, sizeof(ch), (void *)args->arg);
        event.injected_char = ch;
    }

    ioctl_events.perf_submit(args, &event, sizeof(event));
    return 0;
}
"""


class IoctlEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("fd", ctypes.c_uint32),
        ("cmd", ctypes.c_uint32),
        ("arg", ctypes.c_uint64),
        ("injected_char", ctypes.c_uint8),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
    ]


class IoctlSniffer:
    IOCTL_NAMES = {
        0x5412: "TIOCSTI", 0x541C: "TIOCLINUX", 0x540E: "TIOCSCTTY",
        0x5414: "TIOCSWINSZ", 0x5421: "FIONBIO", 0x5402: "TCSETS",
    }
    CRITICAL_IOCTLS = {0x5412, 0x541C, 0x540E}  # TIOCSTI, TIOCLINUX, TIOCSCTTY

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.alert_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None
        self.injected_chars = {}  # pid -> [chars] for TIOCSTI reconstruction

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: ioctl_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def _get_fd_info(self, pid, fd):
        try:
            return os.readlink(f"/proc/{pid}/fd/{fd}")
        except (FileNotFoundError, PermissionError):
            return "unknown"

    def print_banner(self):
        print("=" * 70)
        print("  ioctl_sniff.py - Dangerous Ioctl Monitor (eBPF)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Hooks:       ioctl (TIOCSTI, TIOCLINUX, TIOCSCTTY, TCSETS)")
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
        event = ctypes.cast(data, ctypes.POINTER(IoctlEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        pid = event.pid
        cmd = event.cmd
        cmd_name = self.IOCTL_NAMES.get(cmd, f"IOCTL({hex(cmd)})")
        is_critical = cmd in self.CRITICAL_IOCTLS

        alert = None
        severity = "info"

        if cmd == 0x5412:  # TIOCSTI
            ch = chr(event.injected_char) if 32 <= event.injected_char < 127 else f"\\x{event.injected_char:02x}"
            if pid not in self.injected_chars:
                self.injected_chars[pid] = []
            self.injected_chars[pid].append(event.injected_char)

            alert = "TERMINAL_KEYSTROKE_INJECTION"
            severity = "critical"
            self.alert_count += 1

            if not self.args.json_output:
                reconstructed = ""
                for c in self.injected_chars[pid]:
                    reconstructed += chr(c) if 32 <= c < 127 else f"\\x{c:02x}"
                print(
                    f"\n{'!'*70}\n"
                    f"  !!! TERMINAL KEYSTROKE INJECTION (TIOCSTI) !!!\n"
                    f"  PID={pid} COMM={comm} FD={event.fd}\n"
                    f"  Injected char: '{ch}'\n"
                    f"  Reconstructed: '{reconstructed}'\n"
                    f"{'!'*70}\n",
                    flush=True,
                )

        elif cmd == 0x540E:  # TIOCSCTTY
            alert = "CONTROLLING_TERMINAL_STEAL"
            severity = "critical"
            self.alert_count += 1

        elif cmd == 0x541C:  # TIOCLINUX
            alert = "TIOCLINUX_INJECTION"
            severity = "high"
            self.alert_count += 1

        if self.args.json_output:
            record = {
                "timestamp": timestamp, "pid": pid, "uid": event.uid,
                "comm": comm, "fd": event.fd, "cmd": cmd_name,
                "cmd_hex": hex(cmd), "arg": hex(event.arg),
                "severity": severity,
            }
            if cmd == 0x5412:
                record["injected_char"] = event.injected_char
                record["char_repr"] = chr(event.injected_char) if 32 <= event.injected_char < 127 else f"\\x{event.injected_char:02x}"
            if alert:
                record["alert"] = alert
            print(json.dumps(record), flush=True)
        elif not alert:
            print(
                f"[{timestamp}] PID={pid:<8} UID={event.uid:<6} "
                f"COMM={comm:<16} CMD={cmd_name:<16} FD={event.fd}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.print_banner()
        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF
        self.bpf = BPF(text=BPF_PROGRAM)
        self.bpf["ioctl_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing dangerous ioctl operations... Hit Ctrl+C to stop.\n")
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
        print(f"\n--- ioctl_sniff summary ---")
        print(f"Captured {self.event_count} event(s), Alerts: {self.alert_count}")
        if self.injected_chars:
            print(f"TIOCSTI injection targets: {len(self.injected_chars)} PIDs")
            for pid, chars in self.injected_chars.items():
                s = "".join(chr(c) if 32 <= c < 127 else "." for c in chars)
                print(f"  PID {pid}: \"{s}\" ({len(chars)} chars)")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor dangerous ioctl operations (TIOCSTI, TIOCLINUX, TIOCSCTTY) via eBPF.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Examples:\n  sudo python3 ioctl_sniff.py --duration 60\n  sudo python3 ioctl_sniff.py --json-output",
    )
    parser.add_argument("--json-output", action="store_true", default=False)
    parser.add_argument("--duration", type=int, default=None, metavar="SECONDS")
    args = parser.parse_args()
    IoctlSniffer(args).run()


if __name__ == "__main__":
    main()
