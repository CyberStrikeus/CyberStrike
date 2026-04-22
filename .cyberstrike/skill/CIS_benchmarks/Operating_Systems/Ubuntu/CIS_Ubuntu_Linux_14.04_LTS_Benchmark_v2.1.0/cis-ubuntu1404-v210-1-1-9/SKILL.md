---
name: "CIS Ubuntu 14.04 LTS - 1.1.9 Ensure noexec option set on /var/tmp partition"
description: "Ensure noexec option is set on /var/tmp partition to prevent executable binaries"
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
cis_id: "1.1.9"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 1.1.9 Ensure noexec option set on /var/tmp partition (Scored)

## Profile Applicability
- Level 1 - Server
- Level 1 - Workstation

## Description
The noexec mount option specifies that the filesystem cannot contain executable binaries.

## Rationale
Since the /var/tmp filesystem is only intended for temporary file storage, set this option to ensure that users cannot run executable binaries from /var/tmp.

## Audit Procedure
```bash
mount | grep /var/tmp
# Verify that the noexec option is set on /var/tmp
# Expected output: tmpfs on /var/tmp type tmpfs (rw,nosuid,nodev,noexec,relatime)
```

## Expected Result
The output should show the `noexec` option is set for the /var/tmp partition.

## Remediation
```bash
# Edit the /etc/fstab file and add noexec to the fourth field (mounting options)
# for the /var/tmp partition. See the fstab(5) manual page for more information.

# Run the following command to remount /var/tmp:
mount -o remount,noexec /var/tmp
```

## Default Value
By default, the noexec option is not set on /var/tmp.

## References
- CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0
- CIS Controls: 2 Inventory of Authorized and Unauthorized Software

## Profile
- Level 1
