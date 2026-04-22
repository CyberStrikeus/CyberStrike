---
skill_id: cis-ubuntu1804-v220-5-2-2-2
name: cis-ubuntu1804-v220-5-2-2-2
description: "Configure auditd to keep audit logs and never delete them automatically"
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

## Control 5.2.2.2 - Ensure audit logs are not automatically deleted (Automated)

### Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

### Description

The `max_log_file_action` setting determines how to handle the audit log file reaching the max file size. A value of `keep_logs` will rotate the logs but never delete old logs.

### Rationale

In high security contexts, the benefits of maintaining a long audit history exceed the cost of storing the audit history.

### Audit

Run the following command and verify output matches:

```bash
grep max_log_file_action /etc/audit/auditd.conf
```

**Expected Output:**

```
max_log_file_action = keep_logs
```

### Remediation

Set the following parameter in `/etc/audit/auditd.conf`:

```
max_log_file_action = keep_logs
```

### References

- NIST SP 800-53 Rev. 5: AU-8

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
