---
name: cis-ubuntu2004-v300-6-2-1-2
description: "Ensure journald log file access is configured"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, journald]
cis_id: "6.2.1.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.1.2 Ensure journald log file access is configured (Manual)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Journald will create logfiles that do not already exist on the system. This setting controls what permissions will be applied to these newly created files.

## Rationale

It is important to ensure that log files have the correct permissions to ensure that sensitive data is archived and protected.

## Audit Procedure

### Command Line

Run the following script to verify:

- systemd-journald logfiles are mode `0640` or more restrictive
- Directories `/run/` and `/var/lib/systemd/` are mode `0755` or more restrictive
- All other configured directories are mode `2755`, `0750`, or more restrictive

```bash
#!/usr/bin/env bash
{
    a_output=() a_output2=()
    l_systemd_config_file="/etc/tmpfiles.d/systemd.conf" l_analyze_cmd="$(readlink -f /bin/systemd-analyze)"
    f_file_chk()
    {
        l_maxperm="$( printf '%o' $(( 0777 & ~$1_perm_mask )) )"
        if [ $(( $l_mode & $l_perm_mask )) -le 0 ] || [[ "$l_type" = "Directory" && "$l_mode" =~ 275{0|5} ]];
    then
            a_out+=(" - $l_type \"$l_logfile\" access is:" \
            "     mode: \"$l_mode\", owned by: \"$l_user\", and group owned by: \"$l_group\"")
        else
            a_out2+=(" - $l_type \"$l_logfile\" access is:" \
            "     mode: \"$l_mode\", owned by: \"$l_user\", and group owned by: \"$l_group\"" \
            "     should be mode: \"$l_maxperm\" or more restrictive")
        fi
    }
    # ... (full audit script from benchmark)
}
```

## Expected Result

Review the output. All files in `/var/log/` should have appropriate permissions and ownership.

## Remediation

### Command Line

If the default configuration is not appropriate for the site specific requirements, copy `/usr/lib/tmpfiles.d/systemd.conf` to `/etc/tmpfiles.d/systemd.conf` and modify as required. Recommended mode for logfiles is `0640` or more restrictive.

## Default Value

Logfiles are created with mode 0640 by default.

## References

1. NIST SP 800-53 Rev. 5: AC-3, AU-2, AU-12, MP-2, SI-5

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | | | |
| v7 | 14.6 Protect Information through Access Control Lists | | | |

### MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|------------------------------|---------|-------------|
| T1070, T1070.002, T1083, T1083.000 | TA0007 | M1022 |
