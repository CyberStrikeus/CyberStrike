---
name: cis-ubuntu1804-v220-1-1-2-2
description: "Ensure nodev option set on /tmp partition"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, partition, tmp, mount-option, nodev]
cis_id: "1.1.2.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure nodev option set on /tmp partition

## Profile

Level 1 - Server / Level 1 - Workstation, Assessment: Automated

## Description

The nodev mount option specifies that the filesystem cannot contain special devices.

## Rationale

Since the /tmp filesystem is not intended to support devices, set this option to ensure that users cannot create block or character special devices in /tmp.

## Impact

None noted.

## Audit Procedure

### Command Line

Verify that the nodev option is set for the /tmp mount.

```bash
# findmnt -kn /tmp | grep nodev
```

## Expected Result

```
/tmp     tmpfs  tmpfs   rw,nosuid,nodev,noexec,relatime,seclabel
```

## Remediation

### Command Line

Edit the /etc/fstab file and add nodev to the fourth field (mounting options) for the /tmp partition.

```bash
# Example:
# <device> /tmp   <fstype>   defaults,rw,nosuid,nodev,noexec,relatime   0 0

# Run the following command to remount /tmp with the configured options:
mount -o remount /tmp
```

## Default Value

Not set by default.

## References

1. See the fstab(5) manual page for more information.
2. NIST SP 800-53 Rev. 5: AC-3, MP-2

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists (IG 1, IG 2, IG 3)
v7 - 14.6 Protect Information through Access Control Lists (IG 1, IG 2, IG 3)

MITRE ATT&CK Mappings: T1200, T1200.000 (TA0005) - M1022
