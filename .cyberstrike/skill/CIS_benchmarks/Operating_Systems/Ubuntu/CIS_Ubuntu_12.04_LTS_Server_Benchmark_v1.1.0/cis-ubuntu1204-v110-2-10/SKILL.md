---
name: cis-ubuntu1204-v110-2-10
description: "Add nodev Option to /home"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, filesystem, home, nodev, mount-options]
cis_id: "2.10"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.10 Add nodev Option to /home (Scored)

## Profile Applicability
- Level 1

## Description
When set on a file system, this option prevents character and block special devices from being defined, or if they exist, from being used as character and block special devices.

## Rationale
Since the user partitions are not intended to support devices, set this option to ensure that users cannot attempt to create block or character special devices.

**Note:** The actions in the item refer to the `/home` partition, which is the default user partition that is defined in many distributions. If you have created other user partitions, it is recommended that the Remediation and Audit steps be applied to these partitions as well.

## Audit Procedure
### Using Command Line
```bash
grep /home /etc/fstab | grep nodev
mount | grep /home | grep nodev
```

## Expected Result
Both commands should return output showing `nodev` is set. If either command emits no output then the system is not configured as recommended.

## Remediation
### Using Command Line
Edit the `/etc/fstab` file and add `nodev` to the fourth field (mounting options). See the `fstab(5)` manual page for more information.
```bash
mount -o remount,nodev /home
```

## Default Value
By default, the `nodev` option is not set on the `/home` partition.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
