---
name: cis-ubuntu1204-v110-2-4
description: "Set noexec option for /tmp Partition"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, filesystem, tmp, noexec, mount-options]
cis_id: "2.4"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.4 Set noexec option for /tmp Partition (Scored)

## Profile Applicability
- Level 1

## Description
The `noexec` mount option specifies that the filesystem cannot contain executable binaries.

## Rationale
Since the `/tmp` filesystem is only intended for temporary file storage, set this option to ensure that users cannot run executable binaries from `/tmp`.

## Audit Procedure
### Using Command Line
```bash
grep /tmp /etc/fstab | grep noexec
mount | grep /tmp | grep noexec
```

## Expected Result
Both commands should return output showing `noexec` is set. If either command emits no output then the system is not configured as recommended.

## Remediation
### Using Command Line
Edit the `/etc/fstab` file and add `noexec` to the fourth field (mounting options). See the `fstab(5)` manual page for more information.
```bash
mount -o remount,noexec /tmp
```

## Default Value
By default, the `noexec` option is not set on the `/tmp` partition.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
