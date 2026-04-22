---
name: cis-ubuntu1804-v220-1-1-6-3
description: "Ensure noexec option set on /var/log/audit partition"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, partition, var-log-audit, mount-option, noexec]
cis_id: "1.1.6.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure noexec option set on /var/log/audit partition

## Profile

Level 1 - Server / Level 1 - Workstation, Assessment: Automated

## Description

The noexec mount option specifies that the filesystem cannot contain executable binaries.

## Rationale

Since the /var/log/audit filesystem is only intended for audit log files, set this option to ensure that users cannot run executable binaries from /var/log/audit.

## Impact

None noted.

## Audit Procedure

### Command Line

Verify that the noexec option is set for the /var/log/audit mount.

```bash
# findmnt -kn /var/log/audit | grep noexec
```

## Expected Result

```
/var/log/audit     /dev/sda5  ext4   rw,nosuid,nodev,noexec,relatime,seclabel
```

## Remediation

### Command Line

Edit the /etc/fstab file and add noexec to the fourth field (mounting options) for the /var/log/audit partition.

```bash
# Example:
# <device> /var/log/audit   <fstype>   defaults,rw,nosuid,nodev,noexec,relatime   0 0

# Run the following command to remount /var/log/audit with the configured options:
mount -o remount /var/log/audit
```

## Default Value

Not set by default.

## References

1. See the fstab(5) manual page for more information.
2. NIST SP 800-53 Rev. 5: CM-11

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists (IG 1, IG 2, IG 3)
v7 - 14.6 Protect Information through Access Control Lists (IG 1, IG 2, IG 3)

MITRE ATT&CK Mappings: T1204, T1204.002 (TA0005) - M1022
