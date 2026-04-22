---
name: "CIS Ubuntu 14.04 LTS - 1.1.13 Ensure nodev option set on /home partition"
description: "Ensure nodev option is set on /home partition to prevent special device access"
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
cis_id: "1.1.13"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 1.1.13 Ensure nodev option set on /home partition (Scored)

## Profile Applicability
- Level 1 - Server
- Level 1 - Workstation

## Description
The nodev mount option specifies that the filesystem cannot contain special devices.

## Rationale
Since the user partitions are not intended to support devices, set this option to ensure that users cannot attempt to create block or character special devices.

## Audit Procedure
```bash
mount | grep /home
# Verify that the nodev option is set on /home
# Expected output: /dev/xvdf1 on /home type ext4 (rw,nodev,relatime,data=ordered)
```

## Expected Result
The output should show the `nodev` option is set for the /home partition.

## Remediation
```bash
# Edit the /etc/fstab file and add nodev to the fourth field (mounting options)
# for the /home partition. See the fstab(5) manual page for more information.

# Run the following command to remount /home:
mount -o remount,nodev /home
```

## Default Value
By default, the nodev option is not set on /home.

## Notes
The actions in this recommendation refer to the /home partition, which is the default user partition that is defined in many distributions. If you have created other user partitions, it is recommended that the Remediation and Audit steps be applied to these partitions as well.

## References
- CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0

## Profile
- Level 1
