---
name: cis-ubuntu1804-v220-1-5-2
description: "Ensure core dumps are restricted"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, core-dumps, process-hardening, security]
cis_id: "1.5.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.5.2 Ensure core dumps are restricted (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

A core dump is the memory of an executable program. It is generally used to determine why a program aborted. It can also be used to glean confidential information from a core file. The system provides the ability to set a soft limit for core dumps, but this can be overridden by the user.

## Rationale

Setting a hard limit on core dumps prevents users from overriding the soft variable. If core dumps are required, consider setting limits for user groups (see `limits.conf(5)`). In addition, setting the `fs.suid_dumpable` variable to 0 will prevent setuid programs from dumping core.

## Audit Procedure

### Command Line

Run the following command and verify output matches:

```bash
grep -Es '^(\*|\s).*hard.*core.*(\s+#.*)?$' /etc/security/limits.conf /etc/security/limits.d/*
```

Run the following script to verify `fs.suid_dumpable = 0`:

```bash
#!/usr/bin/env bash
{
    l_output="" l_output2=""
    a_parlist=("fs.suid_dumpable=0")
    l_ufwscf="$([ -f /etc/default/ufw ] && awk -F= '/^\s*IPT_SYSCTL=/ {print $2}' /etc/default/ufw)"
    a_searchpath=("/run/sysctl.d/" "/etc/sysctl.d/" "/usr/local/lib/sysctl.d/" "/usr/lib/sysctl.d/" "/lib/sysctl.d/")
    unset A_files
    declare -A A_files
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
        l_krp="$(sysctl "$l_kpname" | awk -F= '{print $2}' | xargs)"
        if [ "$l_krp" = "$l_kpvalue" ]; then
            l_output="$l_output\n - \"$l_kpname\" is correctly set to \"$l_krp\" in the running configuration"
        else
            l_output2="$l_output2\n - \"$l_kpname\" is incorrectly set to \"$l_krp\" in the running configuration and should have a value of: \"$l_kpvalue\""
        fi
    }
    while IFS="=" read -r l_kpname l_kpvalue; do
        l_kpname="${l_kpname// /}"; l_kpvalue="${l_kpvalue// /}"
        kernel_parameter_chk
    done < <(printf '%s\n' "${a_parlist[@]}")
    unset A_files; unset a_sorted
    if [ -z "$l_output2" ]; then
        echo -e "\n- Audit Result:\n  ** PASS **\n$l_output\n"
    else
        echo -e "\n- Audit Result:\n  ** FAIL **\n - Reason(s) for audit failure:\n$l_output2\n"
        [ -n "$l_output" ] && echo -e "\n- Correctly set:\n$l_output\n"
    fi
}
```

Run the following command to check if systemd-coredump is installed:

```bash
systemctl is-enabled coredump.service
```

If `enabled`, `masked`, or `disabled` is returned systemd-coredump is installed.

## Expected Result

```
* hard core 0
```

## Remediation

### Command Line

Add the following line to `/etc/security/limits.conf` or a `/etc/security/limits.d/*` file:

```
* hard core 0
```

Set the following parameter in `/etc/sysctl.conf` or a file in `/etc/sysctl.d/` ending in `.conf`:

- `fs.suid_dumpable = 0`

Example:

```bash
printf '%s\n' "fs.suid_dumpable = 0" >> /etc/sysctl.d/60-fs_sysctl.conf
```

Run the following command to set the active kernel parameter:

```bash
sysctl -w fs.suid_dumpable=0
```

Note: If these settings appear in a conically later file, or later in the same file, these settings will be overwritten.

IF systemd-coredump is installed: edit `/etc/systemd/coredump.conf` and add/modify the following lines:

```
Storage=none
ProcessSizeMax=0
```

Run the command:

```bash
systemctl daemon-reload
```

## References

1. NIST SP 800-53 Rev. 5: CM-6

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1005, T1005.000 | TA0007 | M1057 |
