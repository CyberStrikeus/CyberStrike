---
name: cis-ubuntu2004-v300-6-3-2-1
description: "Ensure audit log storage size is configured"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, auditing, auditd]
cis_id: "6.3.2.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.3.2.1 Ensure audit log storage size is configured (Automated)

## Profile

- Level 2 - Server
- Level 2 - Workstation

## Description

Configure the maximum size of the audit log file. Once the log reaches the maximum size, it will be rotated and a new log file will be started.

## Rationale

It is important that an appropriate size is determined for log files so that they do not impact the system and audit data is not lost.

## Audit Procedure

### Command Line

Run the following command and ensure output is in compliance with site policy:

```bash
# grep -Po -- '^\h*max_log_file\h*=\h*\d+\b' /etc/audit/auditd.conf
max_log_file = <MB>
```

## Expected Result

The `max_log_file` parameter should be set in accordance with site policy.

## Remediation

### Command Line

Set the following parameter in `/etc/audit/auditd.conf` in accordance with site policy:

```
max_log_file = <MB>
```

## Default Value

`max_log_file = 8`

## References

1. NIST SP 800-53 Rev. 5: AU-8

Additional Information: The `max_log_file` parameter is measured in megabytes. Other methods of log rotation may be appropriate based on site policy. One example is time-based rotation strategies which don't have native support in auditd configurations. Manual audit of custom configurations should be evaluated for effectiveness and completeness.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.3 Ensure Adequate Audit Log Storage | X | X | X |
| v7 | 6.4 Ensure adequate storage for logs | | X | X |

MITRE ATT&CK Mappings: T1562, T1562.006 / TA0040 / M1053
