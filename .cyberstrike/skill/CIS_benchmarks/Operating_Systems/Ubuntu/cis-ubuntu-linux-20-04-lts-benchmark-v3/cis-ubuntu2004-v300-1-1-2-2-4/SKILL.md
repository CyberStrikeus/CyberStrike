---
name: cis-ubuntu2004-v300-1-1-2-2-4
description: "Ensure noexec option set on /dev/shm partition"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, partition]
cis_id: "1.1.2.2.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure noexec option set on /dev/shm partition

## Profile

Level 1 - Server, Level 1 - Workstation, Assessment: Automated

## Description

The `noexec` mount option specifies that the filesystem cannot contain executable binaries.

## Rationale

Setting this option on a file system prevents users from executing programs from shared memory. This deters users from introducing potentially malicious software on the system.

## Audit Procedure

### Command Line

- IF - a separate partition exists for `/dev/shm`, verify that the `noexec` option is set.

```bash
# findmnt -kn /dev/shm | grep -v 'noexec'
```

Nothing should be returned

## Expected Result

Nothing should be returned

## Remediation

### Command Line

- IF - a separate partition exists for `/dev/shm`.
  Edit the `/etc/fstab` file and add `noexec` to the fourth field (mounting options) for the `/dev/shm` partition. See the `fstab(5)` manual page for more information.
  Example:

```
tmpfs /dev/shm   tmpfs   defaults,rw,nosuid,nodev,noexec,relatime   0 0
```

Run the following command to remount `/dev/shm` with the configured options:

```bash
# mount -o remount /dev/shm
```

Note: It is recommended to use `tmpfs` as the device/filesystem type as `/dev/shm` is used as shared memory space by applications.

## Default Value

Not configured by default.

## References

1. See the fstab(5) manual page for more information.
2. NIST SP 800-53 Rev. 5: AC-3, MP-2
3. NIST SP 800-53 Revision 5 :: CM-7 (2)
4. RHEL 8 STIG Vul ID: V-230510
5. RHEL 8 STIG Rule ID: SV-230510r854051

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists (IG 1, IG 2, IG 3)
v7 - 14.6 Protect Information through Access Control Lists (IG 1, IG 2, IG 3)

MITRE ATT&CK Mappings: T1204, T1204.002 | TA0005 | M1022
