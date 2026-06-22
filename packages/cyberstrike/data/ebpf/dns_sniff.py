#!/usr/bin/env python3
"""
dns_sniff.py - Capture DNS queries via eBPF kprobe on udp_sendmsg.

Attaches a kprobe to udp_sendmsg to intercept outgoing UDP packets
destined for port 53 (DNS). Parses the DNS query name and type from
the packet payload. Requires root privileges.

Part of CyberStrike offensive security platform.
"""

import argparse
import ctypes
import json
import os
import signal
import socket
import struct
import sys
import time
from datetime import datetime

TASK_COMM_LEN = 16
MAX_DNS_NAME_LEN = 253
MAX_PKT_LEN = 512

# DNS query type names
DNS_QTYPES = {
    1: "A",
    2: "NS",
    5: "CNAME",
    6: "SOA",
    12: "PTR",
    15: "MX",
    16: "TXT",
    28: "AAAA",
    33: "SRV",
    35: "NAPTR",
    43: "DS",
    46: "RRSIG",
    47: "NSEC",
    48: "DNSKEY",
    52: "TLSA",
    65: "HTTPS",
    255: "ANY",
    256: "URI",
    257: "CAA",
}

BPF_PROGRAM = r"""
#include <uapi/linux/ptrace.h>
#include <linux/sched.h>
#include <linux/socket.h>
#include <linux/in.h>
#include <net/sock.h>
#include <net/inet_sock.h>

#define MAX_DNS_NAME_LEN 253
#define MAX_PKT_LEN      512
#define DNS_HEADER_LEN    12

struct dns_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u32 daddr;          // destination IPv4 address (network byte order)
    u16 dport;          // destination port (host byte order)
    u16 qtype;          // DNS query type
    u16 pkt_len;        // total DNS packet length
    char comm[TASK_COMM_LEN];
    char qname[MAX_DNS_NAME_LEN];
};

BPF_PERF_OUTPUT(dns_events);

// Helper: parse DNS wire-format name into dotted string
// DNS names are encoded as: <len>label<len>label...0
// e.g. \x03www\x06google\x03com\x00 -> www.google.com
static __always_inline int parse_dns_name(const u8 *dns_payload, int payload_len,
                                           char *out, int out_len) {
    int pos = 0;
    int out_pos = 0;

    #pragma unroll
    for (int i = 0; i < 64; i++) {  // max 64 labels
        if (pos >= payload_len || pos >= MAX_PKT_LEN)
            break;

        u8 label_len = 0;
        bpf_probe_read_kernel(&label_len, 1, &dns_payload[pos]);

        if (label_len == 0)
            break;

        // Compression pointer (top 2 bits set) — stop parsing
        if ((label_len & 0xC0) == 0xC0)
            break;

        if (label_len > 63)
            break;

        if (out_pos > 0 && out_pos < out_len - 1) {
            out[out_pos] = '.';
            out_pos++;
        }

        pos += 1;

        // Copy label characters
        int copy_len = label_len;
        if (out_pos + copy_len >= out_len - 1)
            copy_len = out_len - 1 - out_pos;
        if (pos + copy_len > payload_len)
            break;

        bpf_probe_read_kernel(&out[out_pos], copy_len & 0x3F, &dns_payload[pos]);
        out_pos += copy_len;
        pos += label_len;
    }

    if (out_pos < out_len)
        out[out_pos] = '\0';

    return pos + 1;  // skip the terminating 0 byte
}

// kprobe on udp_sendmsg
// int udp_sendmsg(struct sock *sk, struct msghdr *msg, size_t len)
int trace_udp_sendmsg(struct pt_regs *ctx) {
    struct sock *sk = (struct sock *)PT_REGS_PARM1(ctx);
    struct msghdr *msg = (struct msghdr *)PT_REGS_PARM2(ctx);

    // Check destination port (network byte order in sk)
    u16 dport = 0;
    bpf_probe_read_kernel(&dport, sizeof(dport), &sk->__sk_common.skc_dport);
    // dport is in network byte order; DNS is port 53
    if (dport != __constant_htons(53))
        return 0;

    // Read destination address
    u32 daddr = 0;
    bpf_probe_read_kernel(&daddr, sizeof(daddr), &sk->__sk_common.skc_daddr);

    // Read the iov from msghdr to get the DNS packet data
    struct iov_iter iter = {};
    bpf_probe_read_kernel(&iter, sizeof(iter), &msg->msg_iter);

    // For modern kernels, iov_iter may use different backends.
    // We try to read from the iov (iovec) pointer.
    const struct iovec *iov = NULL;
    bpf_probe_read_kernel(&iov, sizeof(iov), &iter.__iov);
    if (!iov)
        return 0;

    // Read the first iovec
    struct iovec first_iov = {};
    bpf_probe_read_kernel(&first_iov, sizeof(first_iov), iov);

    if (!first_iov.iov_base || first_iov.iov_len < DNS_HEADER_LEN)
        return 0;

    // Read the DNS packet (up to MAX_PKT_LEN bytes)
    u8 pkt[MAX_PKT_LEN] = {};
    u32 read_len = first_iov.iov_len;
    if (read_len > MAX_PKT_LEN)
        read_len = MAX_PKT_LEN;
    bpf_probe_read_kernel(&pkt, read_len & (MAX_PKT_LEN - 1), first_iov.iov_base);

    // DNS header: ID(2) + Flags(2) + QDCOUNT(2) + ...
    // Check it's a standard query (QR=0 in flags)
    u16 flags = (pkt[2] << 8) | pkt[3];
    if (flags & 0x8000)  // QR bit set = response, skip
        return 0;

    u16 qdcount = (pkt[4] << 8) | pkt[5];
    if (qdcount == 0)
        return 0;

    struct dns_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    event.daddr = daddr;
    event.dport = 53;
    event.pkt_len = read_len;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    // Parse the DNS query name (starts at offset 12, after the DNS header)
    int name_end = parse_dns_name(&pkt[DNS_HEADER_LEN],
                                   read_len - DNS_HEADER_LEN,
                                   event.qname, MAX_DNS_NAME_LEN);

    // Read query type (2 bytes after the name)
    int qtype_offset = DNS_HEADER_LEN + name_end;
    if (qtype_offset + 2 <= read_len) {
        event.qtype = (pkt[qtype_offset] << 8) | pkt[qtype_offset + 1];
    }

    dns_events.perf_submit(ctx, &event, sizeof(event));
    return 0;
}
"""


class DnsEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("daddr", ctypes.c_uint32),
        ("dport", ctypes.c_uint16),
        ("qtype", ctypes.c_uint16),
        ("pkt_len", ctypes.c_uint16),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
        ("qname", ctypes.c_char * MAX_DNS_NAME_LEN),
    ]


class DnsSniffer:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: dns_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  dns_sniff.py - DNS Query Sniffer (eBPF)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Kprobe:      udp_sendmsg (port 53 filter)")
        print(f"  JSON output: {self.args.json_output}")
        if self.args.duration:
            print(f"  Duration:    {self.args.duration}s")
        else:
            print("  Duration:    unlimited (Ctrl+C to stop)")
        print("=" * 70)
        print()

    def signal_handler(self, signum, frame):
        self.running = False

    @staticmethod
    def int_to_ip(addr):
        """Convert a 32-bit integer (network byte order) to dotted IP string."""
        return socket.inet_ntoa(struct.pack("!I", socket.ntohl(addr)))

    def handle_event(self, cpu, data, size):
        event = ctypes.cast(data, ctypes.POINTER(DnsEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        qname = event.qname.decode("utf-8", errors="replace").rstrip("\x00")
        qtype_num = event.qtype
        qtype_str = DNS_QTYPES.get(qtype_num, f"TYPE{qtype_num}")
        dest_ip = self.int_to_ip(event.daddr)

        if self.args.json_output:
            record = {
                "timestamp": timestamp,
                "pid": event.pid,
                "uid": event.uid,
                "comm": comm,
                "qname": qname,
                "qtype": qtype_str,
                "qtype_num": qtype_num,
                "dest_ip": dest_ip,
                "dest_port": event.dport,
            }
            print(json.dumps(record), flush=True)
        else:
            print(
                f"[{timestamp}] PID={event.pid:<8} "
                f"COMM={comm:<16} "
                f"QUERY={qname:<40} "
                f"TYPE={qtype_str:<8} "
                f"DST={dest_ip}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF

        self.bpf = BPF(text=BPF_PROGRAM)
        self.bpf.attach_kprobe(event="udp_sendmsg", fn_name="trace_udp_sendmsg")

        self.bpf["dns_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing DNS queries... Hit Ctrl+C to stop.\n")
        if not self.args.json_output:
            print(
                f"{'TIMESTAMP':<28} {'PID':<12} "
                f"{'COMM':<20} {'QUERY':<44} "
                f"{'TYPE':<12} {'DST'}"
            )
            print("-" * 130)

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
        print(f"\n--- dns_sniff summary ---")
        print(f"Captured {self.event_count} DNS query event(s)")
        if self.start_time:
            elapsed = time.monotonic() - self.start_time
            print(f"Duration: {elapsed:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Capture DNS queries via eBPF kprobe on udp_sendmsg (port 53).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 dns_sniff.py\n"
            "  sudo python3 dns_sniff.py --json-output --duration 60\n"
            "  sudo python3 dns_sniff.py --json-output | jq '.qname'"
        ),
    )
    parser.add_argument(
        "--json-output",
        action="store_true",
        default=False,
        help="Output DNS events as JSON objects (one per line)",
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=None,
        metavar="SECONDS",
        help="Run for specified duration in seconds, then exit",
    )
    args = parser.parse_args()

    sniffer = DnsSniffer(args)
    sniffer.run()


if __name__ == "__main__":
    main()
