#!/usr/bin/env python3
"""
ssl_sniff.py - Capture SSL/TLS plaintext data via eBPF uprobes.

Attaches uprobes to SSL_write and uretprobes to SSL_read in libssl.so
to intercept plaintext data before encryption / after decryption.
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

MAX_DATA_LEN = 256
TASK_COMM_LEN = 16

BPF_PROGRAM = r"""
#include <uapi/linux/ptrace.h>
#include <linux/sched.h>

#define MAX_DATA_LEN 256

enum ssl_direction {
    SSL_DIR_WRITE = 0,
    SSL_DIR_READ  = 1,
};

struct ssl_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 tid;
    u32 uid;
    u32 data_len;
    u32 buf_len;       // actual bytes copied into buf
    u8  direction;     // 0 = write, 1 = read
    char comm[TASK_COMM_LEN];
    char data[MAX_DATA_LEN];
};

BPF_PERF_OUTPUT(ssl_events);

// Store SSL_read buffer pointer and length on entry so we can read
// the data on return (after it has been filled).
struct ssl_read_args_t {
    u64 buf_ptr;
    u32 len;
};

BPF_HASH(active_ssl_read_args, u64, struct ssl_read_args_t);

FILTER_PID

// --- SSL_write ---
// int SSL_write(SSL *ssl, const void *buf, int num)
int trace_ssl_write_entry(struct pt_regs *ctx) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 pid = pid_tgid >> 32;

#ifdef FILTER_PID_VALUE
    if (pid != FILTER_PID_VALUE)
        return 0;
#endif

    void *buf = (void *)PT_REGS_PARM2(ctx);
    int num = (int)PT_REGS_PARM3(ctx);

    struct ssl_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = pid;
    event.tid = (u32)pid_tgid;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.direction = SSL_DIR_WRITE;
    event.data_len = (u32)num;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    u32 copy_len = (u32)num;
    if (copy_len > MAX_DATA_LEN)
        copy_len = MAX_DATA_LEN;
    event.buf_len = copy_len;

    bpf_probe_read_user(&event.data, copy_len, buf);

    ssl_events.perf_submit(ctx, &event, sizeof(event));
    return 0;
}

// --- SSL_read ---
// int SSL_read(SSL *ssl, void *buf, int num)
int trace_ssl_read_entry(struct pt_regs *ctx) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 pid = pid_tgid >> 32;

#ifdef FILTER_PID_VALUE
    if (pid != FILTER_PID_VALUE)
        return 0;
#endif

    struct ssl_read_args_t args = {};
    args.buf_ptr = (u64)PT_REGS_PARM2(ctx);
    args.len = (u32)PT_REGS_PARM3(ctx);

    active_ssl_read_args.update(&pid_tgid, &args);
    return 0;
}

int trace_ssl_read_return(struct pt_regs *ctx) {
    u64 pid_tgid = bpf_get_current_pid_tgid();
    u32 pid = pid_tgid >> 32;

    struct ssl_read_args_t *args = active_ssl_read_args.lookup(&pid_tgid);
    if (!args)
        return 0;

    int ret = PT_REGS_RC(ctx);
    active_ssl_read_args.delete(&pid_tgid);

    if (ret <= 0)
        return 0;  // SSL_read error or zero-length

    struct ssl_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = pid;
    event.tid = (u32)pid_tgid;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.direction = SSL_DIR_READ;
    event.data_len = (u32)ret;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    u32 copy_len = (u32)ret;
    if (copy_len > MAX_DATA_LEN)
        copy_len = MAX_DATA_LEN;
    event.buf_len = copy_len;

    bpf_probe_read_user(&event.data, copy_len, (void *)args->buf_ptr);

    ssl_events.perf_submit(ctx, &event, sizeof(event));
    return 0;
}
"""


class SslEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("tid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("data_len", ctypes.c_uint32),
        ("buf_len", ctypes.c_uint32),
        ("direction", ctypes.c_uint8),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
        ("data", ctypes.c_char * MAX_DATA_LEN),
    ]


class SslSniffer:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.bytes_captured = 0
        self.start_time = None
        self.running = True
        self.bpf = None

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: ssl_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def find_libssl(self):
        """Locate libssl.so on the system."""
        import subprocess
        candidates = [
            "/lib/x86_64-linux-gnu/libssl.so.3",
            "/lib/x86_64-linux-gnu/libssl.so.1.1",
            "/lib64/libssl.so.3",
            "/lib64/libssl.so.1.1",
            "/usr/lib/libssl.so.3",
            "/usr/lib/libssl.so.1.1",
            "/usr/lib64/libssl.so.3",
            "/usr/lib64/libssl.so.1.1",
            "/usr/lib/x86_64-linux-gnu/libssl.so",
        ]
        for path in candidates:
            if os.path.exists(path):
                return path
        try:
            result = subprocess.run(
                ["ldconfig", "-p"],
                capture_output=True, text=True, timeout=5
            )
            for line in result.stdout.splitlines():
                if "libssl.so" in line and "=>" in line:
                    return line.split("=>")[-1].strip()
        except Exception:
            pass
        print("ERROR: Could not locate libssl.so on this system.", file=sys.stderr)
        sys.exit(1)

    def print_banner(self):
        libssl_path = self.find_libssl()
        print("=" * 70)
        print("  ssl_sniff.py - SSL/TLS Plaintext Sniffer (eBPF)")
        print("=" * 70)
        print(f"  PID:           {os.getpid()}")
        print(f"  libssl:        {libssl_path}")
        if self.args.pid:
            print(f"  Target PID:    {self.args.pid}")
        else:
            print("  Target PID:    all processes")
        print(f"  JSON output:   {self.args.json_output}")
        if self.args.duration:
            print(f"  Duration:      {self.args.duration}s")
        else:
            print("  Duration:      unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print()
        self._libssl_path = libssl_path

    def signal_handler(self, signum, frame):
        self.running = False

    def handle_event(self, cpu, data, size):
        event = ctypes.cast(data, ctypes.POINTER(SslEvent)).contents
        self.event_count += 1
        self.bytes_captured += event.data_len

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        direction = "WRITE" if event.direction == 0 else "READ"

        # Extract captured data
        raw_data = bytes(event.data[:event.buf_len])

        if self.args.json_output:
            try:
                data_str = raw_data.decode("utf-8", errors="replace")
            except Exception:
                data_str = raw_data.hex()

            record = {
                "timestamp": timestamp,
                "pid": event.pid,
                "tid": event.tid,
                "uid": event.uid,
                "comm": comm,
                "direction": direction.lower(),
                "data_len": event.data_len,
                "captured_len": event.buf_len,
                "data": data_str,
            }
            print(json.dumps(record), flush=True)
        else:
            # Try to display as text, fall back to hex
            try:
                preview = raw_data.decode("utf-8", errors="replace")
                # Truncate for display
                if len(preview) > 80:
                    preview = preview[:80] + "..."
                # Replace control characters for display
                preview = preview.replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
            except Exception:
                preview = raw_data[:40].hex()
                if len(raw_data) > 40:
                    preview += "..."

            print(
                f"[{timestamp}] {direction:<5} PID={event.pid:<8} "
                f"COMM={comm:<16} LEN={event.data_len:<8} "
                f"DATA={preview}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF

        # Prepare the BPF program with optional PID filter
        program = BPF_PROGRAM
        if self.args.pid:
            program = program.replace(
                "FILTER_PID",
                f"#define FILTER_PID_VALUE {self.args.pid}"
            )
        else:
            program = program.replace("FILTER_PID", "")

        self.bpf = BPF(text=program)

        # Attach probes to SSL_write
        self.bpf.attach_uprobe(
            name=self._libssl_path,
            sym="SSL_write",
            fn_name="trace_ssl_write_entry",
        )

        # Attach probes to SSL_read (entry + return)
        self.bpf.attach_uprobe(
            name=self._libssl_path,
            sym="SSL_read",
            fn_name="trace_ssl_read_entry",
        )
        self.bpf.attach_uretprobe(
            name=self._libssl_path,
            sym="SSL_read",
            fn_name="trace_ssl_read_return",
        )

        self.bpf["ssl_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing SSL/TLS plaintext... Hit Ctrl+C to stop.\n")
        if not self.args.json_output:
            print(
                f"{'TIMESTAMP':<28} {'DIR':<6} {'PID':<12} "
                f"{'COMM':<20} {'LEN':<12} {'DATA'}"
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
        print(f"\n--- ssl_sniff summary ---")
        print(f"Captured {self.event_count} SSL event(s)")
        print(f"Total plaintext bytes observed: {self.bytes_captured}")
        if self.start_time:
            elapsed = time.monotonic() - self.start_time
            print(f"Duration: {elapsed:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Capture SSL/TLS plaintext via eBPF uprobes on SSL_write/SSL_read.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 ssl_sniff.py\n"
            "  sudo python3 ssl_sniff.py --pid 1234 --json-output\n"
            "  sudo python3 ssl_sniff.py --duration 30 --json-output"
        ),
    )
    parser.add_argument(
        "--pid",
        type=int,
        default=None,
        metavar="PID",
        help="Filter SSL events for a specific process ID",
    )
    parser.add_argument(
        "--json-output",
        action="store_true",
        default=False,
        help="Output captured data as JSON objects (one per line)",
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=None,
        metavar="SECONDS",
        help="Run for specified duration in seconds, then exit",
    )
    args = parser.parse_args()

    sniffer = SslSniffer(args)
    sniffer.run()


if __name__ == "__main__":
    main()
