---
name: cis-ubuntu2004-v300-6-2-3-8
description: "Ensure logrotate is configured"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, rsyslog]
cis_id: "6.2.3.8"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.3.8 Ensure logrotate is configured (Manual)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The system includes the capability of rotating log files regularly to avoid filling up the system with logs or making the logs unmanageably large. The file `/etc/logrotate.d/rsyslog` is the configuration file used to rotate log files created by `rsyslog`.

## Rationale

By keeping the log files smaller and more manageable, a system administrator can easily archive these files to another system and spend less time looking through inordinately large log files.

## Audit Procedure

### Command Line

Run the following script to analyze the `logrotate` configuration:

```bash
#!/usr/bin/env bash
{
    l_analyze_cmd="$(readlink -f /bin/systemd-analyze)" l_config_file="/etc/logrotate.conf"
    l_include="$(awk '$1~/^\s*include$/{print$2}' "$l_config_file" 2>/dev/null)"
    [ -d "$l_include" ] && l_include="$l_include/*"
    $l_analyze_cmd cat-config "$l_config_file" $l_include
}
```

Note: The last occurrence of a argument is the one used for the `logrotate` configuration.

## Expected Result

Review the output to verify logs are rotated according to site policy.

## Remediation

### Command Line

Edit `/etc/logrotate.conf`, or the appropriate configuration file provided by the script in the Audit Procedure, as necessary to ensure logs are rotated according to site policy.

## Default Value

Configured with default rotation settings.

## References

1. NIST SP 800-53 Rev. 5: AU-8

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.3 Ensure Adequate Audit Log Storage | | | |
| v7 | 6.4 Ensure adequate storage for logs | | | |

### MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|------------------------------|---------|-------------|
| T1070, T1070.002 | TA0040 | M1022 |
