---
name: cis-ubuntu1204-v110-2-13
description: "Add nosuid Option to Removable Media Partitions"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, filesystem, removable-media, nosuid, mount-options]
cis_id: "2.13"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.13 Add nosuid Option to Removable Media Partitions (Not Scored)

## Profile Applicability

- Level 1

## Description

Set `nosuid` on removable media to prevent `setuid` and `setgid` executable files that are on that media from being executed as `setuid` and `setgid`.

## Rationale

Setting this option on a file system prevents users from introducing privileged programs onto the system and allowing non-root users to execute them.

## Audit Procedure

### Using Command Line

```bash
grep <each removable media mountpoint> /etc/fstab
```

Verify that `nosuid` is an option.

## Expected Result

The `nosuid` option should be present in the mount options for each removable media mountpoint.

## Remediation

### Using Command Line

Edit the `/etc/fstab` file and add `nosuid` to the fourth field (mounting options). Look for entries that have mount points that contain words such as floppy or cdrom. See the `fstab(5)` manual page for more information.

## Default Value

By default, the `nosuid` option is not set on removable media partitions.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Not Scored
