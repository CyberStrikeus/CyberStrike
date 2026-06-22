#!/usr/bin/env python3
"""
cleanup.py - eBPF Program Cleanup Tool

Enumerates loaded eBPF programs on the system and removes those matching
CyberStrike patterns. Critical for operational security — always run before
leaving a target system to remove tracing artifacts.

Detection methods (in priority order):
  1. bpftool prog list (most reliable, JSON output)
  2. /sys/fs/bpf/ pinned programs
  3. /proc/kallsyms + /sys/kernel/debug/tracing/ inspection

Part of CyberStrike offensive security platform.
Requires root privileges.
"""

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
from pathlib import Path


# -- CyberStrike program name patterns --
# Programs matching any of these patterns will be flagged for removal
CYBERSTRIKE_PATTERNS = [
    r"^cs_",                  # cs_* prefix
    r"^cyberstrike_",         # cyberstrike_* prefix
    r"^pam_sniff",            # PAM credential sniffer
    r"^ssl_sniff",            # SSL/TLS sniffer
    r"^dep_scan",             # Dependency scanner probes
    r"^net_monitor",          # Network monitoring
    r"^proc_exec",            # Process execution tracker
    r"^file_watch",           # File system watcher
    r"^priv_esc",             # Privilege escalation detector
    r"^cred_dump",            # Credential dumper
    r"^keylog",               # Keylogger probes
    r"^shell_snoop",          # Shell command snooper
    r"^dns_sniff",            # DNS sniffer
    r"^sock_trace",           # Socket tracer
    r"^syscall_hook",         # Syscall hooks
]

COMPILED_PATTERNS = [re.compile(p, re.IGNORECASE) for p in CYBERSTRIKE_PATTERNS]

# -- Globals for signal handling --
_interrupted = False


def handle_sigint(signum, frame):
    global _interrupted
    _interrupted = True


def parse_args():
    parser = argparse.ArgumentParser(
        description="CyberStrike eBPF Cleanup Tool - Enumerate and remove CyberStrike eBPF programs from the system",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  sudo python3 cleanup.py                      # List all eBPF programs
  sudo python3 cleanup.py --remove              # Remove CyberStrike programs
  sudo python3 cleanup.py --remove --force      # Force removal without confirmation
  sudo python3 cleanup.py --json-output         # Output as JSON
  sudo python3 cleanup.py --all                 # Show all programs (not just CyberStrike)
  sudo python3 cleanup.py --remove --dry-run    # Show what would be removed

Operational Security:
  Always run this tool before exiting a target system to clean up
  any eBPF tracing artifacts left by CyberStrike agents.
        """,
    )
    parser.add_argument(
        "--remove",
        action="store_true",
        default=False,
        help="Remove eBPF programs matching CyberStrike patterns",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        default=False,
        help="Skip confirmation prompt when removing programs",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Show what would be removed without actually removing",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        default=False,
        help="Show all eBPF programs, not just CyberStrike ones",
    )
    parser.add_argument(
        "--json-output",
        action="store_true",
        default=False,
        help="Output results as structured JSON",
    )
    parser.add_argument(
        "--bpf-fs",
        type=str,
        default="/sys/fs/bpf",
        help="Path to BPF filesystem mount (default: /sys/fs/bpf)",
    )
    return parser.parse_args()


def is_cyberstrike_program(name):
    """Check if a program name matches any CyberStrike pattern."""
    if not name:
        return False
    for pattern in COMPILED_PATTERNS:
        if pattern.search(name):
            return True
    return False


def run_command(cmd, timeout=10):
    """Run a subprocess command and return (returncode, stdout, stderr)."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.returncode, result.stdout, result.stderr
    except FileNotFoundError:
        return -1, "", "command not found"
    except subprocess.TimeoutExpired:
        return -2, "", "command timed out"
    except OSError as e:
        return -3, "", str(e)


# -- Detection Method 1: bpftool --

def detect_bpftool():
    """Check if bpftool is available on the system."""
    return shutil.which("bpftool") is not None


def enumerate_via_bpftool():
    """Use bpftool prog list to enumerate eBPF programs."""
    programs = []
    rc, stdout, stderr = run_command(["bpftool", "prog", "list", "--json"])
    if rc != 0:
        # Try without --json flag (older bpftool versions)
        rc, stdout, stderr = run_command(["bpftool", "prog", "list"])
        if rc != 0:
            return None
        return parse_bpftool_text_output(stdout)

    try:
        progs = json.loads(stdout)
    except json.JSONDecodeError:
        return None

    for prog in progs:
        entry = {
            "id": prog.get("id", -1),
            "type": prog.get("type", "unknown"),
            "name": prog.get("name", ""),
            "tag": prog.get("tag", ""),
            "loaded_at": prog.get("loaded_at", ""),
            "uid": prog.get("uid", -1),
            "bytes_xlated": prog.get("bytes_xlated", 0),
            "bytes_jitted": prog.get("bytes_jitted", 0),
            "bytes_memlock": prog.get("bytes_memlock", 0),
            "map_ids": prog.get("map_ids", []),
            "pids": [],
            "source": "bpftool",
            "is_cyberstrike": False,
            "attachment": "",
        }

        # Extract PIDs if available (bpftool >= 5.8)
        if "pids" in prog:
            entry["pids"] = [
                {"pid": p.get("pid", 0), "comm": p.get("comm", "")}
                for p in prog["pids"]
            ]

        entry["is_cyberstrike"] = is_cyberstrike_program(entry["name"])
        programs.append(entry)

    return programs


def parse_bpftool_text_output(text):
    """Parse text output from bpftool when JSON is not available."""
    programs = []
    current = None

    for line in text.strip().split("\n"):
        if _interrupted:
            break

        # Match program header line: "123: type_name  name prog_name  tag ..."
        header_match = re.match(
            r"(\d+):\s+(\w+)\s+(?:name\s+(\S+)\s+)?(?:tag\s+(\S+))?",
            line.strip(),
        )
        if header_match:
            if current is not None:
                programs.append(current)
            current = {
                "id": int(header_match.group(1)),
                "type": header_match.group(2),
                "name": header_match.group(3) or "",
                "tag": header_match.group(4) or "",
                "loaded_at": "",
                "uid": -1,
                "bytes_xlated": 0,
                "bytes_jitted": 0,
                "bytes_memlock": 0,
                "map_ids": [],
                "pids": [],
                "source": "bpftool",
                "is_cyberstrike": False,
                "attachment": "",
            }
            current["is_cyberstrike"] = is_cyberstrike_program(current["name"])
            continue

        if current is not None:
            # Parse additional fields from indented lines
            loaded_match = re.search(r"loaded_at\s+(.+?)(?:\s{2,}|$)", line)
            if loaded_match:
                current["loaded_at"] = loaded_match.group(1).strip()

            uid_match = re.search(r"uid\s+(\d+)", line)
            if uid_match:
                current["uid"] = int(uid_match.group(1))

            pids_match = re.search(r"pids\s+(.+)", line)
            if pids_match:
                for p in pids_match.group(1).split(","):
                    p = p.strip()
                    pid_detail = re.match(r"(\S+)\((\d+)\)", p)
                    if pid_detail:
                        current["pids"].append({
                            "comm": pid_detail.group(1),
                            "pid": int(pid_detail.group(2)),
                        })

    if current is not None:
        programs.append(current)

    return programs


# -- Detection Method 2: /sys/fs/bpf/ pinned programs --

def enumerate_via_bpffs(bpf_fs_path="/sys/fs/bpf"):
    """Enumerate pinned eBPF programs from the BPF filesystem."""
    programs = []
    bpf_path = Path(bpf_fs_path)

    if not bpf_path.exists() or not bpf_path.is_dir():
        return None

    try:
        for entry in bpf_path.rglob("*"):
            if _interrupted:
                break
            if entry.is_file() or entry.is_symlink():
                name = entry.name
                rel_path = str(entry.relative_to(bpf_path))
                programs.append({
                    "id": -1,
                    "type": "pinned",
                    "name": name,
                    "tag": "",
                    "loaded_at": "",
                    "uid": -1,
                    "bytes_xlated": 0,
                    "bytes_jitted": 0,
                    "bytes_memlock": 0,
                    "map_ids": [],
                    "pids": [],
                    "source": "bpffs",
                    "is_cyberstrike": is_cyberstrike_program(name),
                    "attachment": str(entry),
                    "pin_path": str(entry),
                })
    except PermissionError:
        return None
    except OSError:
        return None

    return programs if programs else None


# -- Detection Method 3: /sys/kernel/debug/tracing/ + /proc/kallsyms --

def enumerate_via_tracefs():
    """Enumerate eBPF programs via tracefs kprobe/uprobe events."""
    programs = []
    tracefs_paths = [
        "/sys/kernel/debug/tracing",
        "/sys/kernel/tracing",
    ]

    tracefs = None
    for p in tracefs_paths:
        if os.path.isdir(p):
            tracefs = p
            break

    if tracefs is None:
        return None

    # Check kprobe_events
    kprobe_file = os.path.join(tracefs, "kprobe_events")
    if os.path.isfile(kprobe_file):
        try:
            with open(kprobe_file, "r") as f:
                for line in f:
                    if _interrupted:
                        break
                    line = line.strip()
                    if not line:
                        continue
                    # Format: p:kprobes/name function or r:kprobes/name function
                    match = re.match(r"([pr]):(?:kprobes/)?(\S+)\s+(\S+)", line)
                    if match:
                        probe_type = "kprobe" if match.group(1) == "p" else "kretprobe"
                        name = match.group(2)
                        func = match.group(3)
                        programs.append({
                            "id": -1,
                            "type": probe_type,
                            "name": name,
                            "tag": "",
                            "loaded_at": "",
                            "uid": -1,
                            "bytes_xlated": 0,
                            "bytes_jitted": 0,
                            "bytes_memlock": 0,
                            "map_ids": [],
                            "pids": [],
                            "source": "tracefs",
                            "is_cyberstrike": is_cyberstrike_program(name),
                            "attachment": func,
                        })
        except (PermissionError, OSError):
            pass

    # Check uprobe_events
    uprobe_file = os.path.join(tracefs, "uprobe_events")
    if os.path.isfile(uprobe_file):
        try:
            with open(uprobe_file, "r") as f:
                for line in f:
                    if _interrupted:
                        break
                    line = line.strip()
                    if not line:
                        continue
                    match = re.match(r"([pr]):(?:uprobes/)?(\S+)\s+(\S+)", line)
                    if match:
                        probe_type = "uprobe" if match.group(1) == "p" else "uretprobe"
                        name = match.group(2)
                        target = match.group(3)
                        programs.append({
                            "id": -1,
                            "type": probe_type,
                            "name": name,
                            "tag": "",
                            "loaded_at": "",
                            "uid": -1,
                            "bytes_xlated": 0,
                            "bytes_jitted": 0,
                            "bytes_memlock": 0,
                            "map_ids": [],
                            "pids": [],
                            "source": "tracefs",
                            "is_cyberstrike": is_cyberstrike_program(name),
                            "attachment": target,
                        })
        except (PermissionError, OSError):
            pass

    # Check available_filter_functions for eBPF attachments
    # (limited info but can indicate BPF presence)

    return programs if programs else None


# -- Removal functions --

def remove_program_bpftool(prog_id):
    """Remove an eBPF program by ID using bpftool."""
    rc, stdout, stderr = run_command(["bpftool", "prog", "detach", "id", str(prog_id)])
    # bpftool prog detach may not work for all types; try unpin or just report
    if rc != 0:
        # Try to unload by closing file descriptors - limited without knowing the fd
        return False, f"bpftool detach failed: {stderr.strip()}"
    return True, "detached via bpftool"


def remove_pinned_program(pin_path):
    """Remove a pinned eBPF program from the BPF filesystem."""
    try:
        os.unlink(pin_path)
        return True, f"removed pin at {pin_path}"
    except OSError as e:
        return False, f"failed to remove pin: {e}"


def remove_kprobe_event(name):
    """Remove a kprobe event by writing to kprobe_events."""
    tracefs_paths = [
        "/sys/kernel/debug/tracing/kprobe_events",
        "/sys/kernel/tracing/kprobe_events",
    ]
    for path in tracefs_paths:
        if os.path.isfile(path):
            try:
                with open(path, "a") as f:
                    f.write(f"-:{name}\n")
                return True, f"removed kprobe event {name}"
            except OSError as e:
                return False, f"failed to remove kprobe event: {e}"
    return False, "kprobe_events not found"


def remove_uprobe_event(name):
    """Remove a uprobe event by writing to uprobe_events."""
    tracefs_paths = [
        "/sys/kernel/debug/tracing/uprobe_events",
        "/sys/kernel/tracing/uprobe_events",
    ]
    for path in tracefs_paths:
        if os.path.isfile(path):
            try:
                with open(path, "a") as f:
                    f.write(f"-:{name}\n")
                return True, f"removed uprobe event {name}"
            except OSError as e:
                return False, f"failed to remove uprobe event: {e}"
    return False, "uprobe_events not found"


def remove_program(prog):
    """Attempt to remove/detach an eBPF program based on its source."""
    source = prog.get("source", "")
    prog_type = prog.get("type", "")

    if source == "bpffs" and "pin_path" in prog:
        return remove_pinned_program(prog["pin_path"])

    if source == "tracefs":
        if prog_type in ("kprobe", "kretprobe"):
            return remove_kprobe_event(prog["name"])
        if prog_type in ("uprobe", "uretprobe"):
            return remove_uprobe_event(prog["name"])

    if source == "bpftool" and prog.get("id", -1) > 0:
        return remove_program_bpftool(prog["id"])

    return False, "no suitable removal method available"


# -- Main logic --

def enumerate_all_programs(bpf_fs_path="/sys/fs/bpf"):
    """Enumerate eBPF programs using all available detection methods."""
    all_programs = []
    methods_used = []

    # Method 1: bpftool (most reliable)
    if detect_bpftool():
        progs = enumerate_via_bpftool()
        if progs is not None:
            all_programs.extend(progs)
            methods_used.append("bpftool")

    # Method 2: BPF filesystem
    progs = enumerate_via_bpffs(bpf_fs_path)
    if progs is not None:
        # Deduplicate against bpftool results by name
        existing_names = {p["name"] for p in all_programs if p["name"]}
        for p in progs:
            if p["name"] not in existing_names:
                all_programs.append(p)
                existing_names.add(p["name"])
        methods_used.append("bpffs")

    # Method 3: tracefs
    progs = enumerate_via_tracefs()
    if progs is not None:
        existing_names = {p["name"] for p in all_programs if p["name"]}
        for p in progs:
            if p["name"] not in existing_names:
                all_programs.append(p)
                existing_names.add(p["name"])
        methods_used.append("tracefs")

    return all_programs, methods_used


def print_text_output(programs, methods_used, show_all=False, removal_results=None):
    """Print results in human-readable text format."""
    cs_programs = [p for p in programs if p["is_cyberstrike"]]
    other_programs = [p for p in programs if not p["is_cyberstrike"]]

    print("=" * 90)
    print(f"{'CyberStrike eBPF Cleanup Tool':^90}")
    print("=" * 90)
    print()
    print(f"  Detection methods used: {', '.join(methods_used) if methods_used else 'none available'}")
    print(f"  Total eBPF programs found: {len(programs)}")
    print(f"  CyberStrike programs found: {len(cs_programs)}")
    print(f"  Other programs found: {len(other_programs)}")
    print()

    if cs_programs:
        print("-" * 90)
        print("  CYBERSTRIKE PROGRAMS (flagged for removal)")
        print("-" * 90)
        print(f"  {'ID':<6} {'Type':<15} {'Name':<25} {'Source':<10} {'Attachment':<30}")
        print(f"  {'-'*6} {'-'*15} {'-'*25} {'-'*10} {'-'*30}")
        for p in cs_programs:
            prog_id = str(p["id"]) if p["id"] >= 0 else "-"
            attachment = p.get("attachment", "")
            if len(attachment) > 28:
                attachment = "..." + attachment[-25:]
            print(f"  {prog_id:<6} {p['type']:<15} {p['name']:<25} {p['source']:<10} {attachment:<30}")
            if p.get("pids"):
                pid_str = ", ".join(f"{pp['comm']}({pp['pid']})" for pp in p["pids"])
                print(f"         PIDs: {pid_str}")
            if p.get("loaded_at"):
                print(f"         Loaded: {p['loaded_at']}")
        print()

    if show_all and other_programs:
        print("-" * 90)
        print("  OTHER eBPF PROGRAMS")
        print("-" * 90)
        print(f"  {'ID':<6} {'Type':<15} {'Name':<25} {'Source':<10} {'Attachment':<30}")
        print(f"  {'-'*6} {'-'*15} {'-'*25} {'-'*10} {'-'*30}")
        for p in other_programs:
            prog_id = str(p["id"]) if p["id"] >= 0 else "-"
            attachment = p.get("attachment", "")
            if len(attachment) > 28:
                attachment = "..." + attachment[-25:]
            print(f"  {prog_id:<6} {p['type']:<15} {p['name']:<25} {p['source']:<10} {attachment:<30}")
        print()

    if removal_results:
        print("-" * 90)
        print("  REMOVAL RESULTS")
        print("-" * 90)
        success_count = sum(1 for r in removal_results if r["success"])
        fail_count = sum(1 for r in removal_results if not r["success"])
        for r in removal_results:
            status = "[OK]" if r["success"] else "[FAIL]"
            print(f"  {status} {r['name']} (ID: {r['id']}): {r['message']}")
        print()
        print(f"  Successfully removed: {success_count}")
        print(f"  Failed to remove: {fail_count}")
        print()

    if not cs_programs and not removal_results:
        print("  [OK] No CyberStrike eBPF programs detected on this system.")
        print()

    print("=" * 90)


def main():
    args = parse_args()

    # Root check
    if os.geteuid() != 0:
        print("[ERROR] This script requires root privileges to enumerate and manage eBPF programs.", file=sys.stderr)
        print("        Run with: sudo python3 cleanup.py", file=sys.stderr)
        sys.exit(1)

    # Install signal handler
    signal.signal(signal.SIGINT, handle_sigint)

    # Enumerate all programs
    programs, methods_used = enumerate_all_programs(bpf_fs_path=args.bpf_fs)

    if _interrupted:
        if args.json_output:
            print(json.dumps({"error": "interrupted", "partial_results": len(programs)}))
        else:
            print("\n[!] Enumeration interrupted by user")
        sys.exit(130)

    cs_programs = [p for p in programs if p["is_cyberstrike"]]
    removal_results = None

    # Handle removal
    if args.remove and cs_programs:
        if args.dry_run:
            if not args.json_output:
                print(f"[*] DRY RUN: Would remove {len(cs_programs)} CyberStrike program(s):")
                for p in cs_programs:
                    print(f"    - {p['name']} (ID: {p['id']}, type: {p['type']})")
                print()
        else:
            # Confirmation prompt (unless --force or --json-output)
            if not args.force and not args.json_output:
                print(f"[!] About to remove {len(cs_programs)} CyberStrike eBPF program(s).")
                print("    This action cannot be undone.")
                try:
                    response = input("    Continue? [y/N] ")
                except (EOFError, KeyboardInterrupt):
                    print("\n[*] Aborted.")
                    sys.exit(0)
                if response.lower() not in ("y", "yes"):
                    print("[*] Aborted.")
                    sys.exit(0)

            removal_results = []
            for p in cs_programs:
                if _interrupted:
                    break
                success, message = remove_program(p)
                removal_results.append({
                    "id": p["id"],
                    "name": p["name"],
                    "type": p["type"],
                    "source": p["source"],
                    "success": success,
                    "message": message,
                })

    # Output
    if args.json_output:
        output = {
            "tool": "cyberstrike-ebpf-cleanup",
            "methods_used": methods_used,
            "total_programs": len(programs),
            "cyberstrike_programs": len(cs_programs),
            "other_programs": len(programs) - len(cs_programs),
            "interrupted": _interrupted,
            "programs": programs if args.all else cs_programs,
        }
        if removal_results is not None:
            output["removal_results"] = removal_results
            output["removed_count"] = sum(1 for r in removal_results if r["success"])
            output["failed_count"] = sum(1 for r in removal_results if not r["success"])
        if args.dry_run:
            output["dry_run"] = True
            output["would_remove"] = len(cs_programs)
        print(json.dumps(output, indent=2))
    else:
        print_text_output(
            programs,
            methods_used,
            show_all=args.all,
            removal_results=removal_results,
        )

    if _interrupted:
        sys.exit(130)


if __name__ == "__main__":
    main()
