---
name: "CIS Ubuntu 14.04 LTS - 1.1.3 Ensure nodev option set on /tmp partition"
description: "Ensure nodev option is set on /tmp partition to prevent special device access"
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
cis_id: "1.1.3"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 1.1.3 Ensure nodev option set on /tmp partition (Scored)

## Profile Applicability
- Level 1 - Server
- Level 1 - Workstation

## Description
The nodev mount option specifies that the filesystem cannot contain special devices.

## Rationale
Since the /tmp filesystem is not intended to support devices, set this option to ensure that users cannot attempt to create block or character special devices in /tmp.

## Audit Procedure
```bash
mount | grep /tmp
# Verify that the nodev option is set on /tmp
# Expected output: tmpfs on /tmp type tmpfs (rw,nosuid,nodev,noexec,relatime)
```

## Expected Result
The output should show the `nodev` option is set for the /tmp partition.

## Remediation
```bash
# Edit the /etc/fstab file and add nodev to the fourth field (mounting options)
# for the /tmp partition. See the fstab(5) manual page for more information.

# Run the following command to remount /tmp:
mount -o remount,nodev /tmp
```

## Default Value
By default, the nodev option is not set on /tmp.

## References
- CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0

## Notes
systemd includes the tmp.mount service which should be used instead of configuring /etc/fstab. Mounting options are configured in the Options setting in /etc/systemd/system/tmp.mount.

## Profile
- Level 1
