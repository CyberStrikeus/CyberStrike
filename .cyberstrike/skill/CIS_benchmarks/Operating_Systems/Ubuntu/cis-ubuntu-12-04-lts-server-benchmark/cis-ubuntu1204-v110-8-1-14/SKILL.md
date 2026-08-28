---
name: cis-ubuntu1204-v110-8-1-14
description: "Collect File Deletion Events by User"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, auditd, delete, unlink, rename]
cis_id: "8.1.14"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.14 Collect File Deletion Events by User (Scored)

## Profile Applicability

- Level 2

## Description

Monitor the use of system calls associated with the deletion or renaming of files and file attributes. This configuration statement sets up monitoring for the `unlink` (remove a file), `unlinkat` (remove a file attribute), `rename` (rename a file) and `renameat` (rename a file attribute) system calls and tags them with the identifier "delete".

## Rationale

Monitoring these calls from non-privileged users could provide a system administrator with evidence that inappropriate removal of files and file attributes associated with protected files is occurring. While this audit option will look at all events, system administrators will want to look for specific privileged files that are being deleted or altered.

## Audit Procedure

### Using Command Line

For 64 bit systems, perform the following command and ensure the output is as shown to determine if file deletion events by user are recorded:

```bash
grep delete /etc/audit/audit.rules
```

For 32 bit systems:

```bash
grep delete /etc/audit/audit.rules
```

## Expected Result

For 64 bit systems:

```
-a always,exit -F arch=b64 -S unlink -S unlinkat -S rename -S renameat -F auid>=500 -F auid!=4294967295 -k delete
-a always,exit -F arch=b32 -S unlink -S unlinkat -S rename -S renameat -F auid>=500 -F auid!=4294967295 -k delete
```

For 32 bit systems:

```
-a always,exit -F arch=b32 -S unlink -S unlinkat -S rename -S renameat -F auid>=500 -F auid!=4294967295 -k delete
```

## Remediation

### Using Command Line

At a minimum, configure the audit system to collect file deletion events for all users and root.

For 64 bit systems, add the following to the `/etc/audit/audit.rules` file:

```bash
-a always,exit -F arch=b64 -S unlink -S unlinkat -S rename -S renameat -F auid>=500 -F auid!=4294967295 -k delete
-a always,exit -F arch=b32 -S unlink -S unlinkat -S rename -S renameat -F auid>=500 -F auid!=4294967295 -k delete
# Execute the following command to restart auditd
pkill -HUP -P 1 auditd
```

For 32 bit systems, add the following to the `/etc/audit/audit.rules` file:

```bash
-a always,exit -F arch=b32 -S unlink -S unlinkat -S rename -S renameat -F auid>=500 -F auid!=4294967295 -k delete
# Execute the following command to restart auditd
pkill -HUP 1-HUP auditd
```

## Default Value

By default, file deletion events by user are not audited.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 2 - Scored
