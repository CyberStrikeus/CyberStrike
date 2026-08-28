---
name: "CIS Ubuntu 14.04 LTS - 1.1.4 Ensure nosuid option set on /tmp partition"
description: "Ensure nosuid option is set on /tmp partition to prevent setuid file creation"
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
cis_id: "1.1.4"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 1.1.4 Ensure nosuid option set on /tmp partition (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The nosuid mount option specifies that the filesystem cannot contain setuid files.

## Rationale

Since the /tmp filesystem is only intended for temporary file storage, set this option to ensure that users cannot create setuid files in /tmp.

## Audit Procedure

```bash
mount | grep /tmp
# Verify that the nosuid option is set on /tmp
# Expected output: tmpfs on /tmp type tmpfs (rw,nosuid,nodev,noexec,relatime)
```

## Expected Result

The output should show the `nosuid` option is set for the /tmp partition.

## Remediation

```bash
# Edit the /etc/fstab file and add nosuid to the fourth field (mounting options)
# for the /tmp partition. See the fstab(5) manual page for more information.

# Run the following command to remount /tmp:
mount -o remount,nosuid /tmp
```

## Default Value

By default, the nosuid option is not set on /tmp.

## References

- CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0

## Notes

systemd includes the tmp.mount service which should be used instead of configuring /etc/fstab. Mounting options are configured in the Options setting in /etc/systemd/system/tmp.mount.

## Profile

- Level 1
