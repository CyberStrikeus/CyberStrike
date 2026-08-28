---
skill_id: cis-ubuntu1804-v220-5-2-2-1
name: cis-ubuntu1804-v220-5-2-2-1
description: "Configure the maximum size of audit log files to prevent system impact and audit data loss"
version: "2.2.0"
category: cis-logging
tags:
  - cis
  - ubuntu
  - linux
  - ubuntu-18.04
  - auditing
  - auditd
profile_applicability:
  - "Level 2 - Server"
  - "Level 2 - Workstation"
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0

## Control 5.2.2.1 - Ensure audit log storage size is configured (Automated)

### Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

### Description

Configure the maximum size of the audit log file. Once the log reaches the maximum size, it will be rotated and a new log file will be started.

### Rationale

It is important that an appropriate size is determined for log files so that they do not impact the system and audit data is not lost.

### Audit

Run the following command and ensure output is in compliance with site policy:

```bash
grep -Po -- '^\h*max_log_file\h*=\h*\d+\b' /etc/audit/auditd.conf
```

**Expected Output:**

```
max_log_file = <MB>
```

### Remediation

Set the following parameter in `/etc/audit/auditd.conf` in accordance with site policy:

```
max_log_file = <MB>
```

### Default Value

```
max_log_file = 8
```

### References

- NIST SP 800-53 Rev. 5: AU-8

### Additional Information

The `max_log_file` parameter is measured in megabytes.

Other methods of log rotation may be appropriate based on site policy. One example is time-based rotation strategies which don't have native support in auditd configurations. Manual audit of custom configurations should be evaluated for effectiveness and completeness.

### CIS Controls

- v8 8.3 Ensure Adequate Audit Log Storage - Ensure that logging destinations maintain adequate storage to comply with the enterprise's audit log management process.
- v7 6.4 Ensure adequate storage for logs - Ensure that all systems that store logs have adequate storage space for the logs generated.

### MITRE ATT&CK Mappings

- Techniques: T1562, T1562.006
- Tactics: TA0040 (Impact)
- Mitigations: M1047 (Audit)

### Benchmark

CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0

### Automation Status

Automated
