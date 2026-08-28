---
name: cis-ubuntu1204-v110-8-1-16
description: "Collect System Administrator Actions (sudolog)"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, auditd, sudo, sudolog, admin-actions]
cis_id: "8.1.16"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.16 Collect System Administrator Actions (sudolog) (Scored)

## Profile Applicability

- Level 2

## Description

Monitor the `sudo` log file. If the system has been properly configured to disable the use of the `su` command and force all administrators to have to log in first and then use `sudo` to execute privileged commands, then all administrator commands will be logged to `/var/log/sudo.log`. Any time a command is executed, an audit event will be triggered as the `/var/log/sudo.log` file will be opened for write and the executed administration command will be written to the log.

## Rationale

Changes in `/var/log/sudo.log` indicate that an administrator has executed a command or the log file itself has been tampered with. Administrators will want to correlate the events written to the audit trail with the records written to `/var/log/sudo.log` to verify if unauthorized commands have been executed.

## Audit Procedure

### Using Command Line

Perform the following to determine if administrator activity is recorded.

```bash
grep actions /etc/audit/audit.rules
```

## Expected Result

```
-w /var/log/sudo.log -p wa -k actions
```

## Remediation

### Using Command Line

Add the following lines to the `/etc/audit/audit.rules` file:

```bash
-w /var/log/sudo.log -p wa -k actions
# Execute the following command to restart auditd
# pkill -HUP -P 1 auditd
```

**Note:** The system must be configured with `su` disabled (See Item 9.5 Restrict Access to the su Command) to force all command execution through `sudo`. This will not be effective on the console, as administrators can log in as root.

## Default Value

By default, system administrator actions (sudolog) are not audited.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 2 - Scored
