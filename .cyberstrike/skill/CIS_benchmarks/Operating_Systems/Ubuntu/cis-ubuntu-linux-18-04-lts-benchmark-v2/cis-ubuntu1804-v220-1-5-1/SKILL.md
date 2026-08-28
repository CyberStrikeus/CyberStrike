---
name: cis-ubuntu1804-v220-1-5-1
description: "Ensure ptrace_scope is restricted"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, ptrace, process-hardening, kernel]
cis_id: "1.5.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.5.1 Ensure ptrace_scope is restricted (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `ptrace()` system call provides a means by which one process (the "tracer") may observe and control the execution of another process (the "tracee"), and examine and change the tracee's memory and registers.

## Rationale

If one application is compromised, it would be possible for an attacker to attach to other running processes (e.g. Bash, Firefox, SSH sessions, GPG agent, etc) to extract additional credentials and continue to expand the scope of their attack.

Enabling restricted mode will limit the ability of a compromised process to PTRACE_ATTACH on other processes running under the same user. With restricted mode, ptrace will continue to work with root user.

## Audit Procedure

### Command Line

Run the following script to verify the following kernel parameter is set in the running configuration and correctly loaded from a kernel parameter configuration file:

- `kernel.yama.ptrace_scope` is set to `1`

Note: kernel parameters are loaded by file and parameter order precedence. The following script observes this precedence as part of the auditing procedure. The parameters being checked may be set correctly in a file. If that file is superseded, the parameter is overridden by an incorrect setting later in that file, or in a canonically later file, that "correct" setting will be ignored both by the script and by the system during a normal kernel parameter load sequence.

```bash
#!/usr/bin/env bash
{
    l_output="" l_output2=""
    a_parlist=("kernel.yama.ptrace_scope=1")
    l_ufwscf="$([ -f /etc/default/ufw ] && awk -F= '/^\s*IPT_SYSCTL=/ {print $2}' /etc/default/ufw)"
    a_searchpath=("/run/sysctl.d/" "/etc/sysctl.d/" "/usr/local/lib/sysctl.d/" "/usr/lib/sysctl.d/" "/lib/sysctl.d/")
    unset A_files
    declare -A A_files # Array of "valid" files
    A_files+=(["sysctl.conf"]="/etc/sysctl.conf")
    for l_searchpath in "${a_searchpath[@]}"; do
        if [ -d "$l_searchpath" ]; then
            while IFS= read -r -d $'\0' l_filename; do
                if [ -f "$l_filename" ]; then
                    l_basename="$(basename "$l_filename")"
                    if [ -z "${A_files["$l_basename"]}" ]; then
                        A_files+=(["$l_basename"]="$l_filename")
                    fi
                fi
            done < <(find "$l_searchpath" -type f -name '*.conf' -print0)
        fi
    done
    a_sorted=()
    while IFS= read -rd '' l_key; do
        a_sorted+=( "$l_key" )
    done < <(printf '%s\0' "${!A_files[@]}" | sort -rz)
    kernel_parameter_chk()
    {
        l_var="" l_var2=""
        l_krp="$(sysctl "$l_kpname" | awk -F= '{print $2}' | xargs)" # Check running configuration
        if [ "$l_krp" = "$l_kpvalue" ]; then
            l_output="$l_output\n - \"$l_kpname\" is correctly set to \"$l_krp\" in the running configuration"
        else
            l_output2="$l_output2\n - \"$l_kpname\" is incorrectly set to \"$l_krp\" in the running configuration and should have a value of: \"$l_kpvalue\""
        fi
    }
    while IFS="=" read -r l_kpname l_kpvalue; do
        l_kpname="${l_kpname// /}"; l_kpvalue="${l_kpvalue// /}"
        if ! grep -Pqs '^\h*0\b' /sys/module/ipv6/parameters/disable && grep -q '^net.ipv6.' <<< "$l_kpname"; then
            l_output="$l_output\n - IPv6 is disabled on the system, \"$l_kpname\" is not applicable"
        else
            kernel_parameter_chk
        fi
    done < <(printf '%s\n' "${a_parlist[@]}")
    unset A_files; unset a_sorted # Remove arrays
    if [ -z "$l_output2" ]; then # Provide output from checks
        echo -e "\n- Audit Result:\n  ** PASS **\n$l_output\n"
    else
        echo -e "\n- Audit Result:\n  ** FAIL **\n - Reason(s) for audit failure:\n$l_output2\n"
        [ -n "$l_output" ] && echo -e "\n- Correctly set:\n$l_output\n"
    fi
}
```

## Expected Result

```
- Audit Result:
  ** PASS **
 - "kernel.yama.ptrace_scope" is correctly set to "1" in the running configuration
```

## Remediation

### Command Line

Set the following parameter in `/etc/sysctl.conf` or a file in `/etc/sysctl.d/` ending in `.conf`:

- `kernel.yama.ptrace_scope = 1`

Example:

```bash
printf '%s\n' "kernel.yama.ptrace_scope = 1" >> /etc/sysctl.d/60-kernel_sysctl.conf
```

Run the following command to set the active kernel parameter:

```bash
sysctl -w kernel.yama.ptrace_scope=1
```

Note: If these settings appear in a canonically later file, or later in the same file, these settings will be overwritten.

## Default Value

kernel.yama.ptrace_scope=1

## Additional Information

Ptrace is very rarely used by regular applications and is mostly used by debuggers such as `gdb` and `strace`.

## References

1. https://www.kernel.org/doc/Documentation/security/Yama.txt
2. https://github.com/raj3shp/termspy

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | X    | X    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              |      | X    | X    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1055.008                   |         |             |
