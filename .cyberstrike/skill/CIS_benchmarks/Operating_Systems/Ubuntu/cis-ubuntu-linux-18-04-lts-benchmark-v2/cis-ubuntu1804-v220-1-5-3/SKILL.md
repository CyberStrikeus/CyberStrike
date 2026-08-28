---
name: cis-ubuntu1804-v220-1-5-3
description: "Ensure address space layout randomization (ASLR) is enabled"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, aslr, process-hardening, kernel, exploit-mitigation]
cis_id: "1.5.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.5.3 Ensure address space layout randomization (ASLR) is enabled (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Address space layout randomization (ASLR) is an exploit mitigation technique which randomly arranges the address space of key data areas of a process.

## Rationale

Randomly placing virtual memory regions will make it difficult to write memory page exploits as the memory placement will be consistently shifting.

## Audit Procedure

### Command Line

Run the following script to verify the following kernel parameter is set in the running configuration and correctly loaded from a kernel parameter configuration file:

- `kernel.randomize_va_space` is set to `2`

```bash
#!/usr/bin/env bash
{
    l_output="" l_output2=""
    a_parlist=("kernel.randomize_va_space=2")
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

## Expected Result

```
- Audit Result:
  ** PASS **
 - "kernel.randomize_va_space" is correctly set to "2" in the running configuration
```

## Remediation

### Command Line

Set the following parameter in `/etc/sysctl.conf` or a file in `/etc/sysctl.d/` ending in `.conf`:

- `kernel.randomize_va_space = 2`

Example:

```bash
printf '%s\n' "kernel.randomize_va_space = 2" >> /etc/sysctl.d/60-kernel_sysctl.conf
```

Run the following command to set the active kernel parameter:

```bash
sysctl -w kernel.randomize_va_space=2
```

Note: If these settings appear in a conically later file, or later in the same file, these settings will be overwritten.

## Default Value

kernel.randomize_va_space = 2

## References

1. http://manpages.ubuntu.com/manpages/focal/man5/sysctl.d.5.html
2. CCI-000366: The organization implements the security configuration settings
3. NIST SP 800-53 Rev. 5: CM-6

## CIS Controls

| Controls Version | Control                                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 10.5 Enable Anti-Exploitation Features                                                    |      | X    | X    |
| v7               | 8.3 Enable Operating System Anti-Exploitation Features / Deploy Anti-Exploit Technologies |      | X    | X    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1068, T1068.000            | TA0002  | M1050       |
