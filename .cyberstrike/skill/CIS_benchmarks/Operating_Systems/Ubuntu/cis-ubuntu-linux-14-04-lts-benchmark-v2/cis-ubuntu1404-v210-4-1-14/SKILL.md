---
name: "CIS Ubuntu 14.04 LTS - 4.1.14 Ensure file deletion events by users are collected"
description: "Collect audit events for file deletion system calls to detect unauthorized removal"
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
  - file-deletion
  - logging
cis_id: "4.1.14"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 4.1.14 Ensure file deletion events by users are collected (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Monitor the use of system calls associated with the deletion or renaming of files and file attributes. This configuration statement sets up monitoring for the `unlink` (remove a file), `unlinkat` (remove a file attribute), `rename` (rename a file) and `renameat` (rename a file attribute) system calls and tags them with the identifier "delete".

## Rationale

Monitoring these calls from non-privileged users could provide a system administrator with evidence that inappropriate removal of files and file attributes associated with protected files is occurring. While this audit option will look at all events, system administrators will want to look for specific privileged files that are being deleted or altered.

## Audit Procedure

On a 32 bit system run the following commands:

```bash
grep delete /etc/audit/audit.rules
auditctl -l | grep delete
```

Verify output of both matches:

```
-a always,exit -F arch=b32 -S unlink -S unlinkat -S rename -S renameat -F auid>=1000 -F auid!=4294967295 -k delete
```

On a 64 bit system run the following commands:

```bash
grep delete /etc/audit/audit.rules
auditctl -l | grep delete
```

Verify output of both matches:

```
-a always,exit -F arch=b64 -S unlink -S unlinkat -S rename -S renameat -F auid>=1000 -F auid!=4294967295 -k delete
-a always,exit -F arch=b32 -S unlink -S unlinkat -S rename -S renameat -F auid>=1000 -F auid!=4294967295 -k delete
```

## Expected Result

The audit rules for delete should be present and active.

## Remediation

For 32 bit systems add the following lines to the `/etc/audit/audit.rules` file:

```bash
-a always,exit -F arch=b32 -S unlink -S unlinkat -S rename -S renameat -F auid>=1000 -F auid!=4294967295 -k delete
```

For 64 bit systems add the following lines to the `/etc/audit/audit.rules` file:

```bash
-a always,exit -F arch=b64 -S unlink -S unlinkat -S rename -S renameat -F auid>=1000 -F auid!=4294967295 -k delete
-a always,exit -F arch=b32 -S unlink -S unlinkat -S rename -S renameat -F auid>=1000 -F auid!=4294967295 -k delete
```

**Notes:** At a minimum, configure the audit system to collect file deletion events for all users and root.

Reloading the auditd config to set active settings may require a system reboot.

## Default Value

Not configured by default.

## References

1. CIS Controls v6.1 - 3.6 Implement Automated Configuration Monitoring System

## Profile

- Level 2 - Server
- Level 2 - Workstation
