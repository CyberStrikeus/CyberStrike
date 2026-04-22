---
skill_id: cis-ubuntu1804-v220-5-2-2-3
name: cis-ubuntu1804-v220-5-2-2-3
description: "Configure the system to halt when audit logs are full to prevent data loss"
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

## Control 5.2.2.3 - Ensure system is disabled when audit logs are full (Automated)

### Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

### Description

The auditd daemon can be configured to halt the system when the audit logs are full.

### Rationale

In high security contexts, the risk of detecting unauthorized access or nonrepudiation exceeds the benefit of the system's availability.

### Audit

Run the following commands and verify output matches:

```bash
grep space_left_action /etc/audit/auditd.conf
```

**Expected Output:**

```
space_left_action = email
```

```bash
grep action_mail_acct /etc/audit/auditd.conf
```

**Expected Output:**

```
action_mail_acct = root
```

```bash
grep admin_space_left_action /etc/audit/auditd.conf
```

**Expected Output:**

```
admin_space_left_action = halt
```

### Remediation

Set the following parameters in `/etc/audit/auditd.conf`:

```
space_left_action = email
action_mail_acct = root
admin_space_left_action = halt
```

### References

- NIST SP 800-53 Rev. 5: AU-5

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
