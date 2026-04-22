---
name: cis-ubuntu2004-v300-1-5-1
description: "Ensure address space layout randomization is enabled"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, aslr, kernel, hardening]
cis_id: "1.5.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.5.1 Ensure address space layout randomization is enabled (Automated)

## Profile

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

Note: kernel parameters are loaded by file and parameter order precedence. The following script observes this precedence as part of the auditing procedure. The parameters being checked may be set correctly in a file. If that file is superseded, the parameter is overridden by an incorrect setting later in that file, or in a canonically later file, that "correct" setting will be ignored both by the script and by the system during a normal kernel parameter load sequence.

```bash
#!/usr/bin/env bash

{
    a_output=(); a_output2=(); a_parlist=(kernel.randomize_va_space=2)
    l_systemdsysctl="$(readlink -f /lib/systemd/systemd-sysctl || readlink -f /usr/lib/systemd/systemd-sysctl)"
    l_ufwscf="$([ -f /etc/default/ufw ] && awk -F= '/^\s*IPT_SYSCTL=/ {print $2}' /etc/default/ufw)"
    f_kernel_parameter_chk()
    {
        l_running_parameter_value="$(sysctl "$l_parameter_name" | awk -F= '{print $2}' | xargs)"
        if grep -Pq -- '\b'"$l_parameter_value"'\b' <<< "$l_running_parameter_value"; then
            a_output+=(" - \"$l_parameter_name\" is correctly set to \"$l_running_parameter_value\"" \
            "    in the running configuration")
        else
            a_output2+=(" - \"$l_parameter_name\" is incorrectly set to \"$l_running_parameter_value\"" \
            "    in the running configuration" \
            "    and should have a value of: \"$l_value_out\"")
        fi
        # ... (full audit script continues)
    }
    # Assessment and output generation
}
```

## Expected Result

Audit Result: ** PASS **

## Remediation

### Command Line

Set the following parameter in `/etc/sysctl.conf` or a file in `/etc/sysctl.d/` ending in `.conf`:

- `kernel.randomize_va_space = 2`

Example:
```bash
# printf "\n%s\n" "kernel.randomize_va_space = 2" >> /etc/sysctl.d/60-kernel_sysctl.conf
```

Run the following command to set the active kernel parameter:

```bash
# sysctl -w kernel.randomize_va_space=2
```

Note: If these settings appear in a canonically later file, or later in the same file, these settings will be overwritten.

## Default Value

kernel.randomize_va_space = 2

## References

1. CCI-000366: The organization implements the security configuration settings
2. NIST SP 800-53: CM-6
3. NIST SP 800-53A: CM-6.1 (iv)
4. NIST SP 800-53: SI-16
5. STIG ID: UBTU-20-010448 | Rule ID: SV-238369r958928 | CAT II
6. STIG ID: UBTU-22-213020 | Rule ID: SV-260474r958928 | CAT II

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 10.5 Enable Anti-Exploitation Features | | * | * |
| v7 | 8.3 Enable Operating System Anti-Exploitation Features | | * | * |

MITRE ATT&CK Mappings: T1068, T1068.000 | TA0002 | M1050
