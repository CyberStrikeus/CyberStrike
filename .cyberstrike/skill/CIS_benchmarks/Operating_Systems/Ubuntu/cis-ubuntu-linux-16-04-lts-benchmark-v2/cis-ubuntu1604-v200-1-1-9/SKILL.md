---
name: cis-ubuntu1604-v200-1-1-9
description: "Ensure noexec option set on /dev/shm partition"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, filesystem, dev-shm, noexec, mount-option]
cis_id: "1.1.9"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure noexec option set on /dev/shm partition

## Description

The noexec mount option specifies that the filesystem cannot contain executable binaries.

## Rationale

Setting this option on a file system prevents users from executing programs from shared memory. This deters users from introducing potentially malicious software on the system.

## Impact

None noted.

## Audit Procedure

### Command Line

```bash
# Run the following command and verify that nothing is returned:
findmnt -n /dev/shm | grep -v noexec
```

## Expected Result

No output should be returned.

## Remediation

### Command Line

```bash
# Edit the /etc/fstab file and add noexec to the fourth field (mounting options) for the /dev/shm partition.
# See the fstab(5) manual page for more information.
# Run the following command to remount /dev/shm:
mount -o remount,nosuid,nodev,noexec /dev/shm
```

## Default Value

Not set by default.

## References

- CIS Controls Version 7 - 2.6 Address unapproved software: Ensure that unauthorized software is either removed or the inventory is updated in a timely manner.

## Profile

Level 1 - Server / Level 1 - Workstation, Assessment: Automated
