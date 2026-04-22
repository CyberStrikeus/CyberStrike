---
name: cis-ubuntu1204-v110-2-16
description: "Add noexec Option to /run/shm Partition"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, filesystem, shared-memory, noexec, mount-options]
cis_id: "2.16"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.16 Add noexec Option to /run/shm Partition (Scored)

## Profile Applicability
- Level 1

## Description
Set `noexec` on the shared memory partition to prevent programs from executing from there.

## Rationale
Setting this option on a file system prevents users from executing programs from shared memory. This deters users from introducing potentially malicious software on the system.

## Audit Procedure
### Using Command Line
```bash
grep /run/shm /etc/fstab | grep noexec
mount | grep /run/shm | grep noexec
```

## Expected Result
Both commands should return output showing `noexec` is set. If either command emits no output then the system is not configured as recommended.

## Remediation
### Using Command Line
Edit the `/etc/fstab` file and add `noexec` to the fourth field (mounting options). Look for entries that have mount points that contain `/run/shm`. See the `fstab(5)` manual page for more information.
```bash
mount -o remount,noexec /run/shm
```

## Default Value
By default, the `noexec` option is not set on the `/run/shm` partition.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
