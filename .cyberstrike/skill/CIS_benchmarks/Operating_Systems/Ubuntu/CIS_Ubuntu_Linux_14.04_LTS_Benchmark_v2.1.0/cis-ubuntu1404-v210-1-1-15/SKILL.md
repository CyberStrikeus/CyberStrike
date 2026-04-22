---
name: "CIS Ubuntu 14.04 LTS - 1.1.15 Ensure nosuid option set on /run/shm partition"
description: "Ensure nosuid option is set on /run/shm partition to prevent privileged programs"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - filesystem
cis_id: "1.1.15"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 1.1.15 Ensure nosuid option set on /run/shm partition (Scored)

## Profile Applicability
- Level 1 - Server
- Level 1 - Workstation

## Description
The nosuid mount option specifies that the filesystem cannot contain setuid files.

## Rationale
Setting this option on a file system prevents users from introducing privileged programs onto the system and allowing non-root users to execute them.

## Audit Procedure
```bash
mount | grep /run/shm
# Verify that the nosuid option is set on /run/shm
# Expected output: tmpfs on /run/shm type tmpfs (rw,nosuid,nodev,noexec,relatime)
```

## Expected Result
The output should show the `nosuid` option is set for the /run/shm partition.

## Remediation
```bash
# Edit the /etc/fstab file and add nosuid to the fourth field (mounting options)
# for the /run/shm partition. See the fstab(5) manual page for more information.

# Run the following command to remount /run/shm:
mount -o remount,nosuid /run/shm
```

## Default Value
By default, the nosuid option is not set on /run/shm.

## References
- CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0

## Profile
- Level 1
