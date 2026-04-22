---
name: cis-ubuntu1204-v110-2-11
description: "Add nodev Option to Removable Media Partitions"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, filesystem, removable-media, nodev, mount-options]
cis_id: "2.11"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.11 Add nodev Option to Removable Media Partitions (Not Scored)

## Profile Applicability

- Level 1

## Description

Set `nodev` on removable media to prevent character and block special devices that are present on the removable media from being treated as device files.

## Rationale

Removable media containing character and block special devices could be used to circumvent security controls by allowing non-root users to access sensitive device files such as `/dev/kmem` or the raw disk partitions.

## Audit Procedure

### Using Command Line

```bash
grep <each removable media mountpoint> /etc/fstab
```

Verify that `nodev` is an option.

## Expected Result

The `nodev` option should be present in the mount options for each removable media mountpoint.

## Remediation

### Using Command Line

Edit the `/etc/fstab` file and add `nodev` to the fourth field (mounting options). Look for entries that have mount points that contain words such as floppy or cdrom. See the `fstab(5)` manual page for more information.

## Default Value

By default, the `nodev` option is not set on removable media partitions.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Not Scored
