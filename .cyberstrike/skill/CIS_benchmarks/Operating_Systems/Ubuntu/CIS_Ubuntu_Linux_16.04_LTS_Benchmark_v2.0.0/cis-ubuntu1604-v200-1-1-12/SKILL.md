---
name: cis-ubuntu1604-v200-1-1-12
description: "Ensure /var/tmp partition includes the nodev option"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, filesystem, var-tmp, nodev, mount-option]
cis_id: "1.1.12"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure /var/tmp partition includes the nodev option

## Description

The nodev mount option specifies that the filesystem cannot contain special devices.

## Rationale

Since the /var/tmp filesystem is not intended to support devices, set this option to ensure that users cannot attempt to create block or character special devices in /var/tmp.

## Impact

None noted.

## Audit Procedure

### Command Line

```bash
# If a /var/tmp partition exists, verify that the nodev option is set.
# Run the following command and verify that nothing is returned:
findmnt -n /var/tmp | grep -v nodev
```

## Expected Result

No output should be returned.

## Remediation

### Command Line

```bash
# Edit the /etc/fstab file and add nodev to the fourth field (mounting options) for the /var/tmp partition.
# See the fstab(5) manual page for more information.
# Run the following command to remount /var/tmp:
mount -o remount,nosuid,nodev,noexec /var/tmp
```

## Default Value

Not set by default.

## References

- CIS Controls Version 7 - 5.1 Establish Secure Configurations: Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile

Level 1 - Server / Level 1 - Workstation, Assessment: Automated
