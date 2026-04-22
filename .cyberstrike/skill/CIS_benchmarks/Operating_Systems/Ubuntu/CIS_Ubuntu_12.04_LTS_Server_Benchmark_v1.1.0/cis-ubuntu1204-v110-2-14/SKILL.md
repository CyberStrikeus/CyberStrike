---
name: cis-ubuntu1204-v110-2-14
description: "Add nodev Option to /run/shm Partition"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, filesystem, shared-memory, nodev, mount-options]
cis_id: "2.14"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.14 Add nodev Option to /run/shm Partition (Scored)

## Profile Applicability

- Level 1

## Description

The `nodev` mount option specifies that the `/run/shm` (temporary filesystem stored in memory) cannot contain block or character special devices.

## Rationale

Since the `/run/shm` filesystem is not intended to support devices, set this option to ensure that users cannot attempt to create special devices in `/run/shm` partitions.

## Audit Procedure

### Using Command Line

```bash
grep /run/shm /etc/fstab | grep nodev
mount | grep /run/shm | grep nodev
```

## Expected Result

Both commands should return output showing `nodev` is set. If either command emits no output then the system is not configured as recommended.

## Remediation

### Using Command Line

Edit the `/etc/fstab` file and add `nodev` to the fourth field (mounting options of entries that have mount points that contain `/run/shm`). See the `fstab(5)` manual page for more information.

```bash
mount -o remount,nodev /run/shm
```

## Default Value

By default, the `nodev` option is not set on the `/run/shm` partition.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
