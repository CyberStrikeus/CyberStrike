---
name: cis-ubuntu2004-v300-1-5-2
description: "Ensure ptrace_scope is restricted"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, ptrace, kernel, hardening]
cis_id: "1.5.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.5.2 Ensure ptrace_scope is restricted (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The `ptrace()` system call provides a means by which one process (the "tracer") may observe and control the execution of another process (the "tracee"), and examine and change the tracee's memory and registers.

The sysctl settings (writable only with CAP_SYS_PTRACE) are:

- `0` - classic ptrace permissions: a process can PTRACE_ATTACH to any other process running under the same uid, as long as it is dumpable (i.e. did not transition uids, start privileged, or have called prctl(PR_SET_DUMPABLE...) already). Similarly, PTRACE_TRACEME is unchanged.
- `1` - restricted ptrace: a process must have a predefined relationship with the inferior it wants to call PTRACE_ATTACH on. By default, this relationship is that of only its descendants when the above classic criteria is also met. To change the relationship, an inferior can call prctl(PR_SET_PTRACER, debugger, ...) to declare an allowed debugger PID to call PTRACE_ATTACH on the inferior. Using PTRACE_TRACEME is unchanged.
- `2` - admin-only attach: only processes with CAP_SYS_PTRACE may use ptrace with PTRACE_ATTACH, or through children calling PTRACE_TRACEME.
- `3` - no attach: no processes may use ptrace with PTRACE_ATTACH nor via PTRACE_TRACEME. Once set, this sysctl value cannot be changed.

## Rationale

If one application is compromised, it would be possible for an attacker to attach to other running processes (e.g. Bash, Firefox, SSH sessions, GPG agent, etc) to extract additional credentials and continue to expand the scope of their attack.

Enabling restricted mode will limit the ability of a compromised process to PTRACE_ATTACH on other processes running under the same user. With restricted mode, ptrace will continue to work with root user.

## Audit Procedure

### Command Line

Run the following script to verify the following kernel parameter is set in the running configuration and correctly loaded from a kernel parameter configuration file:

- `kernel.yama.ptrace_scope` is set to a value of: `1`, `2`, or `3`

```bash
#!/usr/bin/env bash

{
    a_output=(); a_output2=(); a_parlist=("kernel.yama.ptrace_scope=(1|2|3)")
    l_systemdsysctl="$(readlink -f /lib/systemd/systemd-sysctl || readlink -f /usr/lib/systemd/systemd-sysctl)"
    l_ufwscf="$([ -f /etc/default/ufw ] && awk -F= '/^\s*IPT_SYSCTL=/ {print $2}' /etc/default/ufw)"
    f_kernel_parameter_chk()
    {
        # ... (full audit script)
    }
}
```

## Expected Result

Audit Result: ** PASS **

## Remediation

### Command Line

Set the `kernel.yama.ptrace_scope` parameter in `/etc/sysctl.conf` or a file in `/etc/sysctl.d/` ending in `.conf` to a value of `1`, `2`, or `3`:

```
kernel.yama.ptrace_scope = 1
   - OR -
kernel.yama.ptrace_scope = 2
   - OR -
kernel.yama.ptrace_scope = 3
```

Example:

```bash
# printf "\n%s\n" "kernel.yama.ptrace_scope = 1" >> /etc/sysctl.d/60-kernel_sysctl.conf
```

Run the following command to set the active kernel parameter:

```bash
# sysctl -w kernel.yama.ptrace_scope=1
```

Note:

- If a value of `2` or `3` is preferred, or required by local site policy, replace the `1` with the desired value of `2` or `3` in the example above
- If this setting appears in a canonically later file, or later in the same file, the setting will be overwritten

## Default Value

kernel.yama.ptrace_scope = 0

## References

1. https://www.kernel.org/doc/Documentation/security/Yama.txt
2. https://github.com/raj3shp/termspy
3. NIST SP 800-53 Rev. 5: CM-6

## Additional Information

Ptrace is very rarely used by regular applications and is mostly used by debuggers such as `gdb` and `strace`.

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | \*   | \*   |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              |      | \*   | \*   |

MITRE ATT&CK Mappings: T1055, T1055.008 | TA0005 | M1040
