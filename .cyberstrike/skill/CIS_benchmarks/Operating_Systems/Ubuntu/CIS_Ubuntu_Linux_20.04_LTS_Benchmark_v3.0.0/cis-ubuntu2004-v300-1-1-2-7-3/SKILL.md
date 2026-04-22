---
name: cis-ubuntu2004-v300-1-1-2-7-3
description: "Ensure nosuid option set on /var/log/audit partition"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, partition]
cis_id: "1.1.2.7.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure nosuid option set on /var/log/audit partition

## Profile

Level 1 - Server, Level 1 - Workstation, Assessment: Automated

## Description

The `nosuid` mount option specifies that the filesystem cannot contain `setuid` files.

## Rationale

Since the `/var/log/audit` filesystem is only intended for variable files such as logs, set this option to ensure that users cannot create `setuid` files in `/var/log/audit`.

## Audit Procedure

### Command Line

- IF - a separate partition exists for `/var/log/audit`, verify that the `nosuid` option is set.
Run the following command to verify that the `nosuid` mount option is set.
Example:

```bash
# findmnt -kn /var/log/audit | grep -v nosuid
```

Nothing should be returned

## Expected Result

Nothing should be returned

## Remediation

### Command Line

- IF - a separate partition exists for `/var/log/audit`.
Edit the `/etc/fstab` file and add `nosuid` to the fourth field (mounting options) for the `/var/log/audit` partition.
Example:

```
<device> /var/log/audit   <fstype>   defaults,rw,nosuid,nodev,noexec,relatime   0 0
```

Run the following command to remount `/var/log/audit` with the configured options:

```bash
# mount -o remount /var/log/audit
```

## Default Value

Not configured by default.

## References

1. See the fstab(5) manual page for more information.
2. NIST SP 800-53 Revision 5 :: CM-7 (2)
3. NIST SP 800-53 Rev. 5: AC-3, MP-2
4. STIG ID: RHEL-08-040130 | RULE ID: SV-230518r958804 | CAT II
5. STIG ID: RHEL-09-231170 | RULE ID: SV-257875r958804 | CAT II

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists (IG 1, IG 2, IG 3)
v7 - 14.6 Protect Information through Access Control Lists (IG 1, IG 2, IG 3)

MITRE ATT&CK Mappings: T1548, T1548.001 | TA0005 | M1022
