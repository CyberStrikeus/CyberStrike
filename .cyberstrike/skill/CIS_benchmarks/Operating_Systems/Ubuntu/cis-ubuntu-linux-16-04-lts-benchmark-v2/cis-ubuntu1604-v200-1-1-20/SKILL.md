---
name: cis-ubuntu1604-v200-1-1-20
description: "Ensure nosuid option set on removable media partitions"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, filesystem, removable-media, nosuid, mount-option]
cis_id: "1.1.20"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure nosuid option set on removable media partitions

## Description

The nosuid mount option specifies that the filesystem cannot contain setuid files.

## Rationale

Setting this option on a file system prevents users from introducing privileged programs onto the system and allowing non-root users to execute them.

## Impact

None noted.

## Audit Procedure

### Command Line

```bash
# Run the following command and verify that the nosuid option is set on all removable media partitions.
mount
```

## Expected Result

Verify that the nosuid option is set on all removable media partitions.

## Remediation

### Command Line

```bash
# Edit the /etc/fstab file and add nosuid to the fourth field (mounting options) of all removable media partitions.
# Look for entries that have mount points that contain words such as floppy or cdrom.
# See the fstab(5) manual page for more information.
```

## Default Value

Not set by default.

## References

- CIS Controls Version 7 - 5.1 Establish Secure Configurations: Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile

Level 1 - Server / Level 1 - Workstation, Assessment: Manual
