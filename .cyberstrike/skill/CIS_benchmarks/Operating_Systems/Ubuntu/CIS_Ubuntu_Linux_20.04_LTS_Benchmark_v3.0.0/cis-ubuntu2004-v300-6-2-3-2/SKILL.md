---
name: cis-ubuntu2004-v300-6-2-3-2
description: "Ensure rsyslog is installed"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, rsyslog]
cis_id: "6.2.3.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.3.2 Ensure rsyslog is installed (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The `rsyslog` software is recommended in environments where `journald` does not meet operation requirements.

## Rationale

The security enhancements of `rsyslog` such as connection-oriented (i.e. TCP) transmission of logs, the option to log to database formats, and the encryption of log data en route to a central logging server) justify installing and configuring the package.

## Audit Procedure

### Command Line

- IF - `rsyslog` is being used for logging on the system:

Run the following command to verify `rsyslog` is installed:

```bash
# dpkg-query -s rsyslog &>/dev/null && echo "rsyslog is installed"
```

## Expected Result

```
rsyslog is installed
```

## Remediation

### Command Line

Run the following command to install `rsyslog`:

```bash
# apt install rsyslog
```

## Default Value

Installed

## References

1. NIST SP 800-53 Rev. 5: AU-2, AU-3, AU-12
2. Ubuntu 20.04 STIG Vuln ID: V-238353 Rule ID: SV-238353r991562 STIG ID: UBTU-20-010432
3. Ubuntu 22.04 STIG Vuln ID: V-260588 Rule ID: SV-260588r991562 STIG ID: UBTU-22-652010

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.2 Collect Audit Logs | | | |
| v7 | 6.2 Activate audit logging | | | |
| v7 | 6.3 Enable Detailed Logging | | | |

### MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|------------------------------|---------|-------------|
| T1005, T1005.000, T1070, T1070.002 | TA0005 | M1029, M1057 |
