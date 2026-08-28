---
name: cis-ubuntu2004-v300-6-3-1-4
description: "Ensure audit_backlog_limit is configured"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, auditing, auditd]
cis_id: "6.3.1.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.3.1.4 Ensure audit_backlog_limit is configured (Automated)

## Profile

- Level 2 - Server
- Level 2 - Workstation

## Description

In the kernel-level audit subsystem, a socket buffer queue is used to hold audit events. Whenever a new audit event is received, it is logged and prepared to be added to this queue.

The kernel boot parameter `audit_backlog_limit=N`, with N representing the amount of messages, will ensure that a queue cannot grow beyond a certain size. If an audit event is logged which would grow the queue beyond this limit, then a failure occurs and is handled according to the system configuration.

## Rationale

If an audit event is logged which would grow the queue beyond the `audit_backlog_limit`, then a failure occurs, auditd records will be lost, and potential malicious activity could go undetected.

## Audit Procedure

### Command Line

Run the following command and verify the `audit_backlog_limit=` parameter is set:

```bash
# find /boot -type f -name 'grub.cfg' -exec grep -Ph -- '^\h*linux' {} + | grep -Pv 'audit_backlog_limit=\d+\b'
```

Nothing should be returned.

## Expected Result

No output should be returned, confirming that `audit_backlog_limit` is set.

## Remediation

### Command Line

Edit `/etc/default/grub` and add `audit_backlog_limit=N` to `GRUB_CMDLINE_LINUX`. The recommended size for N is `8192` or larger.

Example:

```
GRUB_CMDLINE_LINUX="audit_backlog_limit=8192"
```

Run the following command to update the `grub2` configuration:

```bash
# update-grub
```

## Default Value

If `audit_backlog_limit` is not set, the system defaults to `audit_backlog_limit=64`

## References

1. NIST SP 800-53 Rev. 5: AU-2, AU-3, AU-12

## CIS Controls

| Controls Version | Control                     | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs      | X    | X    | X    |
| v7               | 6.2 Activate audit logging  | X    | X    | X    |
| v7               | 6.3 Enable Detailed Logging |      | X    | X    |

MITRE ATT&CK Mappings: T1562, T1562.001 / TA0005 / M1028
