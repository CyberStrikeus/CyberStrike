---
name: cis-ubuntu1604-v200-1-1-8
description: "Ensure nosuid option set on /dev/shm partition"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, filesystem, dev-shm, nosuid, mount-option]
cis_id: "1.1.8"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure nosuid option set on /dev/shm partition

## Description

The nosuid mount option specifies that the filesystem cannot contain setuid files.

## Rationale

Setting this option on a file system prevents users from introducing privileged programs onto the system and allowing non-root users to execute them.

## Impact

None noted.

## Audit Procedure

### Command Line

```bash
# Run the following command and verify that nothing is returned:
findnmt -n /dev/shm | grep -v nosuid
```

## Expected Result

No output should be returned.

## Remediation

### Command Line

```bash
# Edit the /etc/fstab file and add nosuid to the fourth field (mounting options) for the /dev/shm partition.
# See the fstab(5) manual page for more information.
# Run the following command to remount /dev/shm:
mount -o remount,nosuid,nodev,noexec /dev/shm
```

## Default Value

Not set by default.

## References

- CIS Controls Version 7 - 5.1 Establish Secure Configurations: Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile

Level 1 - Server / Level 1 - Workstation, Assessment: Automated
