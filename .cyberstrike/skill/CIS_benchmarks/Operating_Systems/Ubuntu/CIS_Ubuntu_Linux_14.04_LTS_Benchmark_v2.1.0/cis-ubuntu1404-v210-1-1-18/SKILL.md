---
name: "CIS Ubuntu 14.04 LTS - 1.1.18 Ensure nosuid option set on removable media partitions"
description: "Ensure nosuid option is set on removable media partitions to prevent privileged programs"
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
cis_id: "1.1.18"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 1.1.18 Ensure nosuid option set on removable media partitions (Not Scored)

## Profile Applicability
- Level 1 - Server
- Level 1 - Workstation

## Description
The nosuid mount option specifies that the filesystem cannot contain setuid files.

## Rationale
Setting this option on a file system prevents users from introducing privileged programs onto the system and allowing non-root users to execute them.

## Audit Procedure
```bash
# Run the following command and verify that the nosuid option is set on all
# removable media partitions:
mount
```

## Expected Result
All removable media partitions should have the `nosuid` option set.

## Remediation
```bash
# Edit the /etc/fstab file and add nosuid to the fourth field (mounting options)
# of all removable media partitions. Look for entries that have mount points
# that contain words such as floppy or cdrom.
# See the fstab(5) manual page for more information.
```

## Default Value
By default, the nosuid option is not set on removable media partitions.

## References
- CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0

## Profile
- Level 1
