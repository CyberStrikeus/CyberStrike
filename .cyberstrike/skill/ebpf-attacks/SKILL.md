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

### Phase 4 — Blind Spot Detection (20 monitors)

Detect attack primitives that bypass classical syscall hooks and operate through kernel subsystems invisible to standard monitoring.

| Action | Command | Purpose |
|--------|---------|---------|
| io_uring bypass | `ebpf io_uring_sniff --duration 60` | Detect file/socket/connect operations via io_uring that bypass syscall hooks (kernel 5.1+) |
| Fileless execution | `ebpf memfd_exec --duration 60` | Detect memfd_create + execveat diskless payload delivery chains |
| ptrace injection | `ebpf ptrace_sniff --duration 60` | Monitor ATTACH → POKEDATA → SETREGS shellcode injection sequences |
| Cross-process memory | `ebpf crossmem_sniff --duration 60` | Detect stealthy process_vm_writev/readv memory injection |
| Race condition exploits | `ebpf userfaultfd_sniff --duration 60` | Detect userfaultfd-based timing control primitives |
| BPF integrity | `ebpf bpf_integrity --baseline --duration 300` | Verify CyberStrike hook integrity, detect unauthorized BPF program loads |
| Netlink manipulation | `ebpf netlink_sniff --duration 60` | Detect stealthy route/firewall rule manipulation via netlink |
| Sandbox weakening | `ebpf seccomp_sniff --duration 60` | Detect processes disabling their own seccomp/prctl security profiles |
| Shared memory IPC | `ebpf mmap_sniff --duration 60` | Detect covert IPC via mmap MAP_SHARED, shmget, shmat — data flows without syscalls |
| Zero-copy transfers | `ebpf zerocopy_sniff --duration 60` | Detect splice/tee/sendfile64 fd-to-fd transfers invisible to buffer profilers |
| VDSO tampering | `ebpf vdso_sniff --duration 60` | Detect timing side-channels and VDSO page modification attacks |
| Kernel keyring abuse | `ebpf keyring_sniff --duration 60` | Detect credential storage in kernel keyring (add_key/keyctl) |
| Namespace escape | `ebpf namespace_sniff --duration 60` | Detect container escape via setns/unshare namespace pivoting |
| Terminal injection | `ebpf ioctl_sniff --duration 60` | Detect TIOCSTI keystroke injection and terminal manipulation |
| Mount manipulation | `ebpf mount_sniff --duration 60` | Detect overlay/bind mounts hiding changes on sensitive paths |
| FUSE hijacking | `ebpf fuse_sniff --duration 60` | Detect userspace filesystem mounting that bypasses kernel VFS |
| Perf side-channel | `ebpf perf_sniff --duration 60` | Detect perf_event_open side-channel attacks via HW counters |
| BPF map covert channel | `ebpf bpfmap_sniff --duration 60` | Detect covert data sharing via BPF map create/update operations |
| LD_PRELOAD injection | `ebpf ldpreload_sniff --duration 60` | Detect library injection via LD_PRELOAD env and ld.so config |
| Futex covert channel | `ebpf futex_sniff --duration 60` | Detect timing-based covert channels via futex WAIT/WAKE |

**io_uring sniffing** monitors SQE submissions via `io_uring_submit_sqe` kprobe. Operations like CONNECT, READ, WRITE, OPENAT through io_uring bypass classical syscall hooks entirely — a reverse shell built on io_uring is invisible to execve/connect tracepoints.

**Fileless execution detection** correlates `memfd_create` → `write` → `execveat(fd, "", AT_EMPTY_PATH)` chains. The payload never touches disk — it exists only in memory via memfd. This is the primary technique for diskless implant delivery.

**ptrace injection monitoring** tracks the ATTACH → POKEDATA → SETREGS → CONT sequence that constitutes shellcode injection. Each ptrace operation is logged with target PID and memory addresses.

**Cross-process memory monitoring** captures `process_vm_writev`/`process_vm_readv` syscalls. These enable memory injection without ptrace — bypassing ptrace-based detection entirely.

**userfaultfd monitoring** detects creation of userfaultfd file descriptors. Legitimate use is rare (QEMU/KVM live migration); in exploit context, userfaultfd provides precise timing control for race condition exploitation.

**BPF integrity verification** takes a baseline of loaded BPF programs via `bpftool` and periodically verifies no CyberStrike programs have been detached or tampered with. Also monitors `bpf()` syscall for unauthorized program loads.

**Netlink monitoring** captures netlink socket messages for NEWROUTE, DELROUTE, NEWRULE, DELRULE operations — detecting stealthy routing table and firewall rule manipulation.

**Seccomp/prctl monitoring** captures PR_SET_SECCOMP, PR_SET_NO_NEW_PRIVS, PR_SET_NAME, PR_SET_DUMPABLE, and seccomp filter installation — detecting processes weakening their own security profiles or masquerading via name changes.

### Phase 5 — Cleanup (MANDATORY)

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
| io_uring_sniff | kprobe | `io_uring_submit_sqe` | T1014 — Rootkit (syscall bypass) |
| memfd_exec | tracepoint | `memfd_create` + `execveat` | T1620 — Reflective Code Loading |
| ptrace_sniff | tracepoint | `sys_enter_ptrace` | T1055.008 — Ptrace System Calls |
| crossmem_sniff | tracepoint | `process_vm_writev`/`readv` | T1055.012 — Process Hollowing |
| userfaultfd_sniff | tracepoint | `sys_enter_userfaultfd` | T1068 — Exploitation for Privilege Escalation |
| bpf_integrity | tracepoint | `sys_enter_bpf` + bpftool | T1553 — Subvert Trust Controls |
| netlink_sniff | kprobe | `netlink_sendmsg` | T1562.004 — Disable or Modify System Firewall |
| seccomp_sniff | tracepoint | `sys_enter_prctl` + `sys_enter_seccomp` | T1562.001 — Disable or Modify Tools |
| mmap_sniff | tracepoint | `sys_enter_mmap` + `sys_enter_shmget` + `sys_enter_shmat` | T1055.009 — Proc Memory (shared memory IPC) |
| zerocopy_sniff | tracepoint | `sys_enter_splice` + `sys_enter_tee` + `sys_enter_sendfile64` | T1041 — Exfiltration Over C2 Channel |
| vdso_sniff | tracepoint | `sys_enter_clock_gettime` + `sys_enter_mprotect` | T1497.003 — Time Based Evasion |
| keyring_sniff | tracepoint | `sys_enter_add_key` + `sys_enter_keyctl` + `sys_enter_request_key` | T1003 — OS Credential Dumping |
| namespace_sniff | tracepoint | `sys_enter_setns` + `sys_enter_unshare` | T1611 — Escape to Host |
| ioctl_sniff | tracepoint | `sys_enter_ioctl` (TIOCSTI/TIOCLINUX/TIOCSCTTY) | T1056.001 — Keylogging |
| mount_sniff | tracepoint | `sys_enter_mount` + `sys_enter_umount` | T1006 — Direct Volume Access |
| fuse_sniff | tracepoint | `sys_enter_openat` (/dev/fuse) + `sys_enter_mount` (fuse) | T1014 — Rootkit |
| perf_sniff | tracepoint | `sys_enter_perf_event_open` | T1497.003 — Time Based Evasion |
| bpfmap_sniff | tracepoint | `sys_enter_bpf` (MAP_CREATE/UPDATE/LOOKUP/DELETE) | T1071 — Application Layer Protocol |
| ldpreload_sniff | tracepoint | `sys_enter_execve` (env scan) + `sys_enter_openat` (ld.so) | T1574.006 — Dynamic Linker Hijacking |
| futex_sniff | tracepoint | `sys_enter_futex` (WAIT/WAKE/BITSET/PI) | T1029 — Scheduled Transfer |
