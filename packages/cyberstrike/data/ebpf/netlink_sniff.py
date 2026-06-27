#!/usr/bin/env python3
"""
netlink_sniff.py - Monitor netlink socket messages via eBPF.

Attaches a kprobe to netlink_sendmsg to capture netlink messages for
stealthy network configuration changes — route manipulation, firewall
rule injection, and policy routing modifications. Requires root privileges.

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
#include <linux/socket.h>
#include <net/sock.h>

struct netlink_event_t {
    u64 timestamp_ns;
    u32 pid;
    u32 uid;
    u16 nl_family;
    u16 nl_type;
    u16 nl_flags;
    u32 msg_len;
    u32 nl_seq;
    char comm[TASK_COMM_LEN];
};

BPF_PERF_OUTPUT(netlink_events);

int trace_netlink_sendmsg(struct pt_regs *ctx) {
    struct socket *sock = (struct socket *)PT_REGS_PARM1(ctx);
    struct msghdr *msg = (struct msghdr *)PT_REGS_PARM2(ctx);

    struct netlink_event_t event = {};
    event.timestamp_ns = bpf_ktime_get_ns();
    event.pid = bpf_get_current_pid_tgid() >> 32;
    event.uid = bpf_get_current_uid_gid() & 0xFFFFFFFF;
    bpf_get_current_comm(&event.comm, sizeof(event.comm));

    // Read socket protocol (netlink family)
    struct sock *sk = NULL;
    bpf_probe_read_kernel(&sk, sizeof(sk), &sock->sk);
    if (sk) {
        u16 protocol = 0;
        bpf_probe_read_kernel(&protocol, sizeof(protocol), &sk->sk_protocol);
        event.nl_family = protocol;

        FILTER_ROUTE
    }

    // Try to read nlmsghdr from the message
    // Access msg_iter.iov for the first iovec
    struct iov_iter *iter = &msg->msg_iter;
    const struct iovec *iov = NULL;
    bpf_probe_read_kernel(&iov, sizeof(iov), &iter->__iov);

    if (iov) {
        void *base = NULL;
        bpf_probe_read_kernel(&base, sizeof(base), &iov->iov_base);
        if (base) {
            // Read nlmsghdr (first 16 bytes of the message)
            u32 nlmsg_len = 0;
            u16 nlmsg_type = 0;
            u16 nlmsg_flags = 0;
            u32 nlmsg_seq = 0;

            bpf_probe_read_user(&nlmsg_len, sizeof(nlmsg_len), base);
            bpf_probe_read_user(&nlmsg_type, sizeof(nlmsg_type), base + 4);
            bpf_probe_read_user(&nlmsg_flags, sizeof(nlmsg_flags), base + 6);
            bpf_probe_read_user(&nlmsg_seq, sizeof(nlmsg_seq), base + 8);

            event.nl_type = nlmsg_type;
            event.nl_flags = nlmsg_flags;
            event.msg_len = nlmsg_len;
            event.nl_seq = nlmsg_seq;
        }
    }

    netlink_events.perf_submit(ctx, &event, sizeof(event));
    return 0;
}
"""


class NetlinkEvent(ctypes.Structure):
    _fields_ = [
        ("timestamp_ns", ctypes.c_uint64),
        ("pid", ctypes.c_uint32),
        ("uid", ctypes.c_uint32),
        ("nl_family", ctypes.c_uint16),
        ("nl_type", ctypes.c_uint16),
        ("nl_flags", ctypes.c_uint16),
        ("msg_len", ctypes.c_uint32),
        ("nl_seq", ctypes.c_uint32),
        ("comm", ctypes.c_char * TASK_COMM_LEN),
    ]


class NetlinkSniffer:
    NL_FAMILIES = {
        0: "ROUTE", 1: "UNUSED", 2: "USERSOCK", 3: "FIREWALL",
        4: "SOCK_DIAG", 5: "NFLOG", 6: "XFRM", 7: "SELINUX",
        8: "ISCSI", 9: "AUDIT", 10: "FIB_LOOKUP", 11: "CONNECTOR",
        12: "NETFILTER", 13: "IP6_FW", 14: "DNRTMSG", 15: "KOBJECT_UEVENT",
        16: "GENERIC", 18: "SCSITRANSPORT", 19: "ECRYPTFS", 20: "RDMA",
        21: "CRYPTO", 22: "SMC",
    }

    RTM_TYPES = {
        16: "NEWLINK", 17: "DELLINK", 18: "GETLINK",
        20: "NEWADDR", 21: "DELADDR", 22: "GETADDR",
        24: "NEWROUTE", 25: "DELROUTE", 26: "GETROUTE",
        28: "NEWNEIGH", 29: "DELNEIGH", 30: "GETNEIGH",
        32: "NEWRULE", 33: "DELRULE", 34: "GETRULE",
        36: "NEWQDISC", 37: "DELQDISC",
        40: "NEWTFILTER", 41: "DELTFILTER",
    }

    # Modification operations that indicate network manipulation
    DANGEROUS_TYPES = {
        16: "LINK_ADD",
        17: "LINK_DEL",
        20: "ADDR_ADD",
        21: "ADDR_DEL",
        24: "ROUTE_ADD",
        25: "ROUTE_DEL",
        32: "RULE_ADD",
        33: "RULE_DEL",
        36: "QDISC_ADD",
        37: "QDISC_DEL",
        40: "FILTER_ADD",
        41: "FILTER_DEL",
    }

    # Known system processes that legitimately use netlink
    KNOWN_SYSTEM = {"systemd", "NetworkManager", "dhclient", "dhcpcd", "wpa_supplicant",
                    "connmand", "networkd", "systemd-networkd", "ip", "ifconfig", "route"}

    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.alert_count = 0
        self.start_time = None
        self.running = True
        self.bpf = None

    def check_root(self):
        if os.geteuid() != 0:
            print("ERROR: netlink_sniff.py requires root privileges. Run with sudo.", file=sys.stderr)
            sys.exit(1)

    def print_banner(self):
        print("=" * 70)
        print("  netlink_sniff.py - Netlink Socket Monitor (eBPF)")
        print("=" * 70)
        print(f"  PID:         {os.getpid()}")
        print(f"  Hook:        kprobe:netlink_sendmsg")
        print(f"  Route only:  {self.args.route_only}")
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
        event = ctypes.cast(data, ctypes.POINTER(NetlinkEvent)).contents
        self.event_count += 1

        timestamp = datetime.now().isoformat()
        comm = event.comm.decode("utf-8", errors="replace").rstrip("\x00")
        nl_family = event.nl_family
        nl_type = event.nl_type
        family_name = self.NL_FAMILIES.get(nl_family, f"FAMILY({nl_family})")
        type_name = self.RTM_TYPES.get(nl_type, f"TYPE({nl_type})")
        is_dangerous = nl_type in self.DANGEROUS_TYPES
        is_known_system = comm in self.KNOWN_SYSTEM

        alert = None
        severity = "info"

        if is_dangerous and not is_known_system:
            action = self.DANGEROUS_TYPES.get(nl_type, "UNKNOWN")
            alert = f"NETWORK_MANIPULATION_{action}"
            severity = "warning"
            self.alert_count += 1

            if not self.args.json_output:
                print(
                    f"\n{'!'*70}\n"
                    f"  !!! NETWORK MANIPULATION DETECTED !!!\n"
                    f"  PID={event.pid} COMM={comm} (not a known system process)\n"
                    f"  Action: {action} (netlink type {nl_type})\n"
                    f"  Family: {family_name}\n"
                    f"{'!'*70}\n",
                    flush=True,
                )

        if self.args.json_output:
            record = {
                "timestamp": timestamp,
                "pid": event.pid,
                "uid": event.uid,
                "comm": comm,
                "nl_family": nl_family,
                "nl_family_name": family_name,
                "nl_type": nl_type,
                "nl_type_name": type_name,
                "nl_flags": event.nl_flags,
                "msg_len": event.msg_len,
                "nl_seq": event.nl_seq,
                "dangerous": is_dangerous,
                "known_system": is_known_system,
            }
            if alert:
                record["alert"] = alert
                record["severity"] = severity
            print(json.dumps(record), flush=True)
        elif not alert:
            danger_str = " *** MODIFICATION ***" if is_dangerous else ""
            system_str = " (system)" if is_known_system else ""
            print(
                f"[{timestamp}] PID={event.pid:<8} UID={event.uid:<6} "
                f"COMM={comm:<16} FAMILY={family_name:<12} "
                f"TYPE={type_name:<16} LEN={event.msg_len}"
                f"{danger_str}{system_str}",
                flush=True,
            )

    def run(self):
        self.check_root()
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        from bcc import BPF

        bpf_text = BPF_PROGRAM
        if self.args.route_only:
            bpf_text = bpf_text.replace(
                "FILTER_ROUTE",
                "if (protocol != 0) return 0;  // NETLINK_ROUTE only"
            )
        else:
            bpf_text = bpf_text.replace("FILTER_ROUTE", "")

        self.bpf = BPF(text=bpf_text)
        self.bpf.attach_kprobe(event="netlink_sendmsg", fn_name="trace_netlink_sendmsg")

        self.bpf["netlink_events"].open_perf_buffer(self.handle_event, page_cnt=64)

        print("Tracing netlink socket messages... Hit Ctrl+C to stop.\n")
        if not self.args.json_output:
            print(
                f"{'TIMESTAMP':<28} {'PID':<12} {'UID':<10} "
                f"{'COMM':<20} {'FAMILY':<16} {'TYPE':<20} {'LEN'}"
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
        print(f"\n--- netlink_sniff summary ---")
        print(f"Captured {self.event_count} netlink event(s)")
        print(f"Alerts: {self.alert_count}")
        if self.start_time:
            elapsed = time.monotonic() - self.start_time
            print(f"Duration: {elapsed:.1f}s")
        if self.bpf:
            self.bpf.cleanup()
        print("Probes detached. Exiting.")


def main():
    parser = argparse.ArgumentParser(
        description="Monitor netlink socket messages for stealthy network manipulation via eBPF.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  sudo python3 netlink_sniff.py --duration 60\n"
            "  sudo python3 netlink_sniff.py --route-only --json-output\n"
            "  sudo python3 netlink_sniff.py --json-output | jq 'select(.dangerous)'"
        ),
    )
    parser.add_argument(
        "--json-output",
        action="store_true",
        default=False,
        help="Output events as JSON objects (one per line)",
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=None,
        metavar="SECONDS",
        help="Run for specified duration in seconds, then exit",
    )
    parser.add_argument(
        "--route-only",
        action="store_true",
        default=False,
        help="Only show NETLINK_ROUTE family messages",
    )
    args = parser.parse_args()

    sniffer = NetlinkSniffer(args)
    sniffer.run()


if __name__ == "__main__":
    main()
