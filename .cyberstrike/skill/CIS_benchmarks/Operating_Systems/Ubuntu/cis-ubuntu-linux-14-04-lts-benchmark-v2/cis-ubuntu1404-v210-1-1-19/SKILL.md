---
name: "CIS Ubuntu 14.04 LTS - 1.1.19 Ensure noexec option set on removable media partitions"
description: "Ensure noexec option is set on removable media partitions to prevent executable binaries"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - not-scored
  - filesystem
cis_id: "1.1.19"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 1.1.19 Ensure noexec option set on removable media partitions (Not Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The noexec mount option specifies that the filesystem cannot contain executable binaries.

## Rationale

Setting this option on a file system prevents users from executing programs from the removable media. This deters users from being able to introduce potentially malicious software on the system.

## Audit Procedure

```bash
# Run the following command and verify that the noexec option is set on all
# removable media partitions:
mount
```

## Expected Result

All removable media partitions should have the `noexec` option set.

## Remediation

```bash
# Edit the /etc/fstab file and add noexec to the fourth field (mounting options)
# of all removable media partitions. Look for entries that have mount points
# that contain words such as floppy or cdrom.
# See the fstab(5) manual page for more information.
```

## Default Value

By default, the noexec option is not set on removable media partitions.

## References

- CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0
- CIS Controls: 8 Malware Defenses

## Profile

- Level 1
