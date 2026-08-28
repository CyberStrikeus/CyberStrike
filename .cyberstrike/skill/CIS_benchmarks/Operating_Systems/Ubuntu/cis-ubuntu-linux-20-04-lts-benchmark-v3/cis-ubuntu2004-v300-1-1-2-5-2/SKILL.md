---
name: cis-ubuntu2004-v300-1-1-2-5-2
description: "Ensure nodev option set on /var/tmp partition"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, partition]
cis_id: "1.1.2.5.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure nodev option set on /var/tmp partition

## Profile

Level 1 - Server, Level 1 - Workstation, Assessment: Automated

## Description

The `nodev` mount option specifies that the filesystem cannot contain special devices.

## Rationale

Since the `/var/tmp` filesystem is not intended to support devices, set this option to ensure that users cannot create a block or character special devices in `/var/tmp`.

## Audit Procedure

### Command Line

- IF - a separate partition exists for `/var/tmp`, verify that the `nodev` option is set.
  Run the following command to verify that the `nodev` mount option is set.
  Example:

```bash
# findmnt -kn /var/tmp | grep -v nodev
```

Nothing should be returned

## Expected Result

Nothing should be returned

## Remediation

### Command Line

- IF - a separate partition exists for `/var/tmp`.
  Edit the `/etc/fstab` file and add `nodev` to the fourth field (mounting options) for the `/var/tmp` partition.
  Example:

```
<device> /var/tmp   <fstype>   defaults,rw,nosuid,nodev,noexec,relatime   0 0
```

Run the following command to remount `/var/tmp` with the configured options:

```bash
# mount -o remount /var/tmp
```

## Default Value

Not configured by default.

## References

1. See the fstab(5) manual page for more information.
2. NIST SP 800-53 Rev. 5: AC-3, MP-2
3. NIST SP 800-53 Revision 5 :: CM-7 (2)
4. RHEL 8 STIG Vul ID: V-230520
5. RHEL 8 STIG Rule ID: SV-230520r854061

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists (IG 1, IG 2, IG 3)
v7 - 14.6 Protect Information through Access Control Lists (IG 1, IG 2, IG 3)

MITRE ATT&CK Mappings: T1499, T1499.001 | TA0005 | M1022
