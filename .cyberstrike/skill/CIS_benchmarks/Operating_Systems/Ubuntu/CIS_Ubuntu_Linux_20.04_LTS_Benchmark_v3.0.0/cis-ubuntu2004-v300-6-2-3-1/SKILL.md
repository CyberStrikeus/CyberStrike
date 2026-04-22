---
name: cis-ubuntu2004-v300-6-2-3-1
description: "Ensure rsyslog service is enabled and active"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, rsyslog]
cis_id: "6.2.3.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.3.1 Ensure rsyslog service is enabled and active (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Once the `rsyslog` package is installed, ensure that the service is enabled.

## Rationale

If the `rsyslog` service is not enabled to start on boot, the system will not capture logging events.

## Audit Procedure

### Command Line

- IF - `rsyslog` is being used for logging on the system:

Run the following command to verify `rsyslog.service` is enabled:

```bash
# systemctl is-enabled rsyslog
```

Run the following command to verify `rsyslog.service` is active:

```bash
# systemctl is-active rsyslog.service
```

## Expected Result

```
enabled
active
```

## Remediation

### Command Line

- IF - `rsyslog` is being used for logging on the system:

Run the following commands to unmask, enable, and start `rsyslog.service`:

```bash
# systemctl unmask rsyslog.service
# systemctl enable rsyslog.service
# systemctl start rsyslog.service
```

## Default Value

Enabled and active by default.

## References

1. NIST SP 800-53 Rev. 5: AU-2, AU-3, AU-12

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.2 Collect Audit Logs | | | |
| v7 | 6.2 Activate audit logging | | | |
| v7 | 6.3 Enable Detailed Logging | | | |

### MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|------------------------------|---------|-------------|
| T1070, T1070.002, T1211, T1562, T1562.001 | TA0005 | M1029 |
