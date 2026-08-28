---
name: cis-ubuntu1604-v200-1-1-21
description: "Ensure noexec option set on removable media partitions"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, filesystem, removable-media, noexec, mount-option]
cis_id: "1.1.21"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure noexec option set on removable media partitions

## Description

The noexec mount option specifies that the filesystem cannot contain executable binaries.

## Rationale

Setting this option on a file system prevents users from executing programs from the removable media. This deters users from being able to introduce potentially malicious software on the system.

## Impact

None noted.

## Audit Procedure

### Command Line

```bash
# Run the following command and verify that the noexec option is set on all removable media partitions.
mount
```

## Expected Result

Verify that the noexec option is set on all removable media partitions.

## Remediation

### Command Line

```bash
# Edit the /etc/fstab file and add noexec to the fourth field (mounting options) of all removable media partitions.
# Look for entries that have mount points that contain words such as floppy or cdrom.
# See the fstab(5) manual page for more information.
```

## Default Value

Not set by default.

## References

- CIS Controls Version 7 - 2.6 Address unapproved software: Ensure that unauthorized software is either removed or the inventory is updated in a timely manner.

## Profile

Level 1 - Server / Level 1 - Workstation, Assessment: Manual
