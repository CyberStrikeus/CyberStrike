---
name: cis-ubuntu1204-v110-8-1-13
description: "Collect Successful File System Mounts"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, auditd, mount, filesystem]
cis_id: "8.1.13"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.13 Collect Successful File System Mounts (Scored)

## Profile Applicability
- Level 2

## Description
Monitor the use of the `mount` system call. The `mount` (and `umount`) system call controls the mounting and unmounting of file systems. The parameters below configure the system to create an audit record when the mount system call is used by a non-privileged user.

## Rationale
It is highly unusual for a non privileged user to `mount` file systems to the system. While tracking `mount` commands gives the system administrator evidence that external media may have been mounted (based on a review of the source of the mount and confirming it's an external media type), it does not conclusively indicate that data was exported to the media. System administrators who wish to determine if data were exported, would also have to track successful `open`, `creat` and `truncate` system calls requiring write access to a file under the mount point of the external media file system. This could give a fair indication that a write occurred. The only way to truly prove it, would be to track successful writes to the external media. Tracking write system calls could quickly fill up the audit log and is not recommended.

**Note:** This tracks successful and unsuccessful mount commands. File system mounts do not have to come from external media and this action still does not verify write (e.g. CD ROMS).

## Audit Procedure
### Using Command Line
For 64 bit systems perform the following command and ensure the output is as shown to determine if filesystem mounts are recorded:
```bash
grep mounts /etc/audit/audit.rules
```

For 32 bit systems:
```bash
grep mounts /etc/audit/audit.rules
```

## Expected Result
For 64 bit systems:
```
-a always,exit -F arch=b64 -S mount -F auid>=500 -F auid!=4294967295 -k mounts
-a always,exit -F arch=b32 -S mount -F auid>=500 -F auid!=4294967295 -k mounts
```

For 32 bit systems:
```
-a always,exit -F arch=b32 -S mount -F auid>=500 -F auid!=4294967295 -k mounts
```

## Remediation
### Using Command Line
For 64 bit systems, add the following lines to the `/etc/audit/audit.rules` file:
```bash
-a always,exit -F arch=b64 -S mount -F auid>=500 -F auid!=4294967295 -k mounts
-a always,exit -F arch=b32 -S mount -F auid>=500 -F auid!=4294967295 -k mounts
# Execute the following command to restart auditd
pkill -HUP -P 1 auditd
```

For 32 bit systems, add the following lines to the `/etc/audit/audit.rules` file:
```bash
-a always,exit -F arch=b32 -S mount -F auid>=500 -F auid!=4294967295 -k mounts
# Execute the following command to restart auditd
pkill -HUP -P 1 auditd
```

## Default Value
By default, file system mounts are not audited.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 2 - Scored
