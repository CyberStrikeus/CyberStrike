---
name: "CIS Ubuntu 14.04 LTS - 4.1.16 Ensure system administrator actions (sudolog) are collected"
description: "Collect audit events for sudo command execution via the sudo log file"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-2
  - scored
  - auditd
  - sudo
  - logging
cis_id: "4.1.16"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 4.1.16 Ensure system administrator actions (sudolog) are collected (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Monitor the `sudo` log file. If the system has been properly configured to disable the use of the `su` command and force all administrators to have to log in first and then use `sudo` to execute privileged commands, then all administrator commands will be logged to `/var/log/sudo.log`. Any time a command is executed, an audit event will be triggered as the `/var/log/sudo.log` file will be opened for write and the executed administration command will be written to the log.

## Rationale

Changes in `/var/log/sudo.log` indicate that an administrator has executed a command or the log file itself has been tampered with. Administrators will want to correlate the events written to the audit trail with the records written to `/var/log/sudo.log` to verify if unauthorized commands have been executed.

## Audit Procedure

Run the following commands:

```bash
grep actions /etc/audit/audit.rules
auditctl -l | grep actions
```

## Expected Result

Verify output of both matches:

```
-w /var/log/sudo.log -p wa -k actions
```

## Remediation

Add the following lines to the `/etc/audit/audit.rules` file:

```bash
-w /var/log/sudo.log -p wa -k actions
```

**Notes:** The system must be configured with `su` disabled (See Item 5.6 Ensure access to the su command is restricted) to force all command execution through `sudo`. This will not be effective on the console, as administrators can log in as root.

Reloading the auditd config to set active settings may require a system reboot.

## Default Value

Not configured by default.

## References

1. CIS Controls v6.1 - 5.1 Minimize And Sparingly Use Administrative Privileges
2. CIS Controls v6.1 - 5.5 Log Failed Administrative Login Attempts

## Profile

- Level 2 - Server
- Level 2 - Workstation
