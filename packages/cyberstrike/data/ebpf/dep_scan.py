#!/usr/bin/env python3
"""
dep_scan.py - Dependency Scanner for Running Processes

Scans /proc/<pid>/maps for all running processes and extracts loaded shared
libraries (.so files). Optionally cross-references against a built-in list
of known vulnerable library versions.

Part of CyberStrike offensive security platform.
Requires root to read /proc maps of all processes.
"""

import argparse
import json
import os
import re
import signal
import sys
from collections import defaultdict
from pathlib import Path


# -- Known vulnerable libraries database --
# Format: (library_name_pattern, vulnerable_version_check_fn, cve_reference, description)
KNOWN_VULNS = [
    {
        "pattern": r"libssl\.so\.(\d+)\.(\d+)",
        "name": "OpenSSL",
        "check": lambda major, minor, *_: int(major) < 3,
        "cve": "CVE-2022-3602, CVE-2022-3786",
        "desc": "OpenSSL < 3.0 - multiple known vulnerabilities including buffer overflows",
    },
    {
        "pattern": r"libcrypto\.so\.(\d+)\.(\d+)",
        "name": "OpenSSL (libcrypto)",
        "check": lambda major, minor, *_: int(major) < 3,
        "cve": "CVE-2022-3602, CVE-2022-3786",
        "desc": "OpenSSL libcrypto < 3.0 - multiple known vulnerabilities",
    },
    {
        "pattern": r"libxml2\.so\.(\d+)\.(\d+)\.(\d+)",
        "name": "libxml2",
        "check": lambda major, minor, patch, *_: int(major) == 2 and int(minor) < 12,
        "cve": "CVE-2023-45322, CVE-2023-39615",
        "desc": "libxml2 < 2.12 - use-after-free and buffer overread vulnerabilities",
    },
    {
        "pattern": r"libcurl\.so\.(\d+)",
        "name": "libcurl",
        "check": lambda major, *_: int(major) < 4,
        "cve": "CVE-2023-38545, CVE-2023-38546",
        "desc": "libcurl < 4 - SOCKS5 heap buffer overflow (curl CVE-2023-38545)",
    },
    {
        "pattern": r"libsqlite3\.so\.(\d+)\.(\d+)\.(\d+)",
        "name": "SQLite3",
        "check": lambda major, minor, patch, *_: int(major) == 0 and int(minor) < 8 and int(patch) < 41,
        "cve": "CVE-2022-35737",
        "desc": "SQLite3 < 3.39.2 - array bounds overflow vulnerability",
    },
    {
        "pattern": r"libgnutls\.so\.(\d+)",
        "name": "GnuTLS",
        "check": lambda major, *_: int(major) < 30,
        "cve": "CVE-2023-0361",
        "desc": "GnuTLS < 3.8 - timing side-channel in RSA-PSK key exchange",
    },
    {
        "pattern": r"libssh\.so\.(\d+)",
        "name": "libssh",
        "check": lambda major, *_: int(major) < 4,
        "cve": "CVE-2023-6004, CVE-2023-48795",
        "desc": "libssh < 0.10.6 - command injection and Terrapin attack",
    },
    {
        "pattern": r"libpng\d*\.so\.(\d+)",
        "name": "libpng",
        "check": lambda major, *_: int(major) < 16,
        "cve": "CVE-2019-7317",
        "desc": "libpng < 1.6.37 - use-after-free vulnerability",
    },
    {
        "pattern": r"libz\.so\.(\d+)\.(\d+)\.(\d+)",
        "name": "zlib",
        "check": lambda major, minor, patch, *_: int(major) == 1 and int(minor) == 2 and int(patch) < 12,
        "cve": "CVE-2022-37434",
        "desc": "zlib < 1.2.12 - heap-based buffer over-read in inflate",
    },
    {
        "pattern": r"libexpat\.so\.(\d+)\.(\d+)\.(\d+)",
        "name": "Expat XML Parser",
        "check": lambda major, minor, patch, *_: int(major) == 1 and (int(minor) < 2 or (int(minor) == 2 and int(patch) < 5)),
        "cve": "CVE-2022-25313, CVE-2022-25314",
        "desc": "Expat < 2.5.0 - stack exhaustion and integer overflow",
    },
    {
        "pattern": r"liblog4j.*?(\d+)\.(\d+)",
        "name": "Log4j (Java via JNI)",
        "check": lambda major, minor, *_: int(major) == 2 and int(minor) < 17,
        "cve": "CVE-2021-44228 (Log4Shell)",
        "desc": "Log4j < 2.17 - remote code execution via JNDI lookup",
    },
    {
        "pattern": r"libpolkit-gobject.*?\.so\.(\d+)",
        "name": "Polkit",
        "check": lambda major, *_: int(major) == 0,
        "cve": "CVE-2021-4034 (PwnKit)",
        "desc": "Polkit pkexec - local privilege escalation",
    },
]


# -- Globals for signal handling --
_interrupted = False


def handle_sigint(signum, frame):
    global _interrupted
    _interrupted = True


def parse_args():
    parser = argparse.ArgumentParser(
        description="CyberStrike Dependency Scanner - Scan running processes for loaded shared libraries and known vulnerabilities",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  sudo python3 dep_scan.py                     # Scan all processes
  sudo python3 dep_scan.py --pid 1234          # Scan specific process
  sudo python3 dep_scan.py --vuln-check        # Check for known vulnerabilities
  sudo python3 dep_scan.py --json-output       # Output as JSON
  sudo python3 dep_scan.py --pid 1234 --vuln-check --json-output
        """,
    )
    parser.add_argument(
        "--pid",
        type=int,
        default=None,
        help="Scan a specific process by PID (default: all processes)",
    )
    parser.add_argument(
        "--vuln-check",
        action="store_true",
        default=False,
        help="Cross-reference loaded libraries against known vulnerable versions",
    )
    parser.add_argument(
        "--json-output",
        action="store_true",
        default=False,
        help="Output results as structured JSON",
    )
    parser.add_argument(
        "--no-sort",
        action="store_true",
        default=False,
        help="Do not sort output by number of unique libraries per process",
    )
    return parser.parse_args()


def get_process_name(pid):
    """Read the process name from /proc/<pid>/comm."""
    try:
        comm_path = Path(f"/proc/{pid}/comm")
        return comm_path.read_text().strip()
    except (PermissionError, FileNotFoundError, OSError):
        return "<unknown>"


def get_process_cmdline(pid):
    """Read the full command line from /proc/<pid>/cmdline."""
    try:
        cmdline_path = Path(f"/proc/{pid}/cmdline")
        raw = cmdline_path.read_bytes()
        return raw.replace(b"\x00", b" ").decode("utf-8", errors="replace").strip()
    except (PermissionError, FileNotFoundError, OSError):
        return ""


def extract_version_from_path(lib_path):
    """Try to extract a version string from a shared library filename.

    Examples:
      /usr/lib/libssl.so.3.0.2 -> "3.0.2"
      /usr/lib/libcrypto.so.1.1 -> "1.1"
      /usr/lib/x86_64-linux-gnu/libz.so.1.2.11 -> "1.2.11"
      /usr/lib/libfoo.so -> None
    """
    basename = os.path.basename(lib_path)
    # Match version numbers after .so.
    match = re.search(r"\.so\.(.+)$", basename)
    if match:
        version_str = match.group(1)
        # Validate it looks like a version (digits and dots)
        if re.match(r"^[\d.]+$", version_str):
            return version_str
    # Try matching version in the library name itself (e.g., libpng16.so)
    match = re.search(r"(\d+)\.so", basename)
    if match:
        return match.group(1)
    return None


def parse_maps_file(pid):
    """Parse /proc/<pid>/maps and return a set of unique .so library paths."""
    libraries = set()
    maps_path = f"/proc/{pid}/maps"
    try:
        with open(maps_path, "r") as f:
            for line in f:
                if _interrupted:
                    return libraries
                parts = line.strip().split()
                if len(parts) < 6:
                    continue
                filepath = parts[5]
                # Filter for shared libraries
                if ".so" in filepath and os.path.isabs(filepath):
                    # Normalize: resolve symlinks where possible
                    try:
                        resolved = os.path.realpath(filepath)
                    except OSError:
                        resolved = filepath
                    libraries.add(resolved)
    except PermissionError:
        pass
    except FileNotFoundError:
        pass
    except OSError:
        pass
    return libraries


def check_vulnerabilities(lib_path):
    """Check a library path against the known vulnerability database.
    Returns a list of matching vulnerability entries."""
    findings = []
    basename = os.path.basename(lib_path)
    for vuln in KNOWN_VULNS:
        match = re.search(vuln["pattern"], basename)
        if match:
            groups = match.groups()
            try:
                if vuln["check"](*groups):
                    findings.append({
                        "library": vuln["name"],
                        "cve": vuln["cve"],
                        "description": vuln["desc"],
                        "detected_version_parts": list(groups),
                    })
            except (ValueError, IndexError):
                continue
    return findings


def get_all_pids():
    """Get all numeric PIDs from /proc."""
    pids = []
    try:
        for entry in os.listdir("/proc"):
            if entry.isdigit():
                pids.append(int(entry))
    except OSError:
        pass
    return sorted(pids)


def scan_process(pid, vuln_check=False):
    """Scan a single process and return its library information."""
    proc_name = get_process_name(pid)
    if proc_name == "<unknown>":
        return None

    libraries = parse_maps_file(pid)
    if not libraries:
        return None

    lib_entries = []
    vuln_findings = []

    for lib_path in sorted(libraries):
        version = extract_version_from_path(lib_path)
        entry = {
            "path": lib_path,
            "version": version,
        }
        lib_entries.append(entry)

        if vuln_check:
            findings = check_vulnerabilities(lib_path)
            for finding in findings:
                finding["library_path"] = lib_path
                vuln_findings.append(finding)

    return {
        "pid": pid,
        "name": proc_name,
        "cmdline": get_process_cmdline(pid),
        "libraries": lib_entries,
        "library_count": len(lib_entries),
        "vulnerabilities": vuln_findings if vuln_check else [],
    }


def print_text_output(results, vuln_check=False):
    """Print results in human-readable text format."""
    total_libs = 0
    total_vulns = 0

    print("=" * 90)
    print(f"{'CyberStrike Dependency Scanner':^90}")
    print("=" * 90)
    print()

    for proc in results:
        if _interrupted:
            print("\n[!] Scan interrupted by user")
            break

        total_libs += proc["library_count"]
        vuln_count = len(proc["vulnerabilities"])
        total_vulns += vuln_count

        vuln_marker = f"  [!!! {vuln_count} VULN(S)]" if vuln_count > 0 else ""
        print(f"[PID {proc['pid']}] {proc['name']} ({proc['library_count']} libraries){vuln_marker}")
        if proc["cmdline"]:
            cmdline_display = proc["cmdline"][:80] + ("..." if len(proc["cmdline"]) > 80 else "")
            print(f"  CMD: {cmdline_display}")
        print(f"  {'Library Path':<60} {'Version':<15}")
        print(f"  {'-' * 60} {'-' * 15}")

        for lib in proc["libraries"]:
            version_str = lib["version"] if lib["version"] else "-"
            path_display = lib["path"]
            if len(path_display) > 58:
                path_display = "..." + path_display[-55:]
            print(f"  {path_display:<60} {version_str:<15}")

        if vuln_check and proc["vulnerabilities"]:
            print()
            print(f"  >>> VULNERABILITY FINDINGS:")
            for v in proc["vulnerabilities"]:
                print(f"  [VULN] {v['library']} - {v['cve']}")
                print(f"         {v['description']}")
                print(f"         Path: {v['library_path']}")
        print()

    print("=" * 90)
    print(f"Total processes scanned: {len(results)}")
    print(f"Total unique libraries found: {total_libs}")
    if vuln_check:
        print(f"Total vulnerability findings: {total_vulns}")
    print("=" * 90)


def main():
    args = parse_args()

    # Root check
    if os.geteuid() != 0:
        print("[ERROR] This script requires root privileges to read /proc maps of all processes.", file=sys.stderr)
        print("        Run with: sudo python3 dep_scan.py", file=sys.stderr)
        sys.exit(1)

    # Install signal handler
    signal.signal(signal.SIGINT, handle_sigint)

    # Determine which PIDs to scan
    if args.pid is not None:
        if not os.path.isdir(f"/proc/{args.pid}"):
            msg = f"[ERROR] Process with PID {args.pid} does not exist."
            if args.json_output:
                print(json.dumps({"error": msg}))
            else:
                print(msg, file=sys.stderr)
            sys.exit(1)
        pids = [args.pid]
    else:
        pids = get_all_pids()

    if not args.json_output:
        print(f"[*] Scanning {len(pids)} process(es)...")
        if args.vuln_check:
            print(f"[*] Vulnerability cross-reference enabled ({len(KNOWN_VULNS)} signatures loaded)")
        print()

    # Scan all processes
    results = []
    for pid in pids:
        if _interrupted:
            break
        result = scan_process(pid, vuln_check=args.vuln_check)
        if result is not None:
            results.append(result)

    # Sort by number of unique libraries (descending) unless --no-sort
    if not args.no_sort:
        results.sort(key=lambda x: x["library_count"], reverse=True)

    # Output
    if args.json_output:
        output = {
            "scanner": "cyberstrike-dep-scan",
            "total_processes": len(results),
            "total_libraries": sum(r["library_count"] for r in results),
            "vuln_check_enabled": args.vuln_check,
            "total_vulnerabilities": sum(len(r["vulnerabilities"]) for r in results) if args.vuln_check else 0,
            "interrupted": _interrupted,
            "processes": results,
        }
        print(json.dumps(output, indent=2))
    else:
        print_text_output(results, vuln_check=args.vuln_check)

    if _interrupted:
        sys.exit(130)


if __name__ == "__main__":
    main()
