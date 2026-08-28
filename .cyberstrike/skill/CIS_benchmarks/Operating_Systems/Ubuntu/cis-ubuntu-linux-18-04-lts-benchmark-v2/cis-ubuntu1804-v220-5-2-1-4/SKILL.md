---
skill_id: cis-ubuntu1804-v220-5-2-1-4
name: cis-ubuntu1804-v220-5-2-1-4
description: "Configure the audit_backlog_limit kernel parameter to prevent audit event loss"
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

## Control 5.2.1.4 - Ensure audit_backlog_limit is sufficient (Automated)

### Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

### Description

In the kernel-level audit subsystem, a socket buffer queue is used to hold audit events. Whenever a new audit event is received, it is logged and prepared to be added to this queue.

The kernel boot parameter `audit_backlog_limit=N`, with N representing the amount of messages, will ensure that a queue cannot grow beyond a certain size. If an audit event is logged which would grow the queue beyond this limit, then a failure occurs and is handled according to the system configuration.

### Rationale

If an audit event is logged which would grow the queue beyond the `audit_backlog_limit`, then a failure occurs, auditd records will be lost, and potential malicious activity could go undetected.

### Audit

Run the following command and verify the `audit_backlog_limit=` parameter is set:

```bash
find /boot -type f -name 'grub.cfg' -exec grep -Ph -- '^\h*linux\b' {} + | grep -Pv 'audit_backlog_limit=\d+\b'
```

**Expected Output:**
Nothing should be returned.

### Remediation

Edit `/etc/default/grub` and add `audit_backlog_limit=N` to `GRUB_CMDLINE_LINUX`. The recommended size for N is 8192 or larger.

**Example:**

```
GRUB_CMDLINE_LINUX="audit_backlog_limit=8192"
```

Run the following command to update the grub2 configuration:

```bash
update-grub
```

### Default Value

If `audit_backlog_limit` is not set, the system defaults to `audit_backlog_limit=64`

### References

- NIST SP 800-53 Rev. 5: AU-2, AU-3, AU-12

### CIS Controls

- v8 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets.
- v7 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices.
- v7 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements.

### MITRE ATT&CK Mappings

- Techniques: T1562, T1562.001
- Tactics: TA0005 (Defense Evasion)
- Mitigations: M1028 (Operating System Configuration), M1047 (Audit)

### Benchmark

CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0

### Automation Status

Automated
