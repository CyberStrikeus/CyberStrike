---
name: cis-ubuntu2004-v300-1-1-2-7-4
description: "Ensure noexec option set on /var/log/audit partition"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, filesystem, partition, var-log-audit]
cis_id: "1.1.2.7.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure noexec option set on /var/log/audit partition

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The noexec mount option specifies that the filesystem cannot contain executable binaries.

## Rationale

Since the /var/log/audit filesystem is only intended for audit logs, set this option to ensure that users cannot run executable binaries from /var/log/audit.

## Audit

- IF - a separate partition exists for /var/log/audit, verify that the noexec option is set.

Run the following command to verify that the noexec mount option is set.

### Command Line

```bash
# findmnt -kn /var/log/audit | grep -v noexec
```

## Expected Result

Nothing should be returned

## Remediation

- IF - a separate partition exists for /var/log/audit.

Edit the /etc/fstab file and add noexec to the fourth field (mounting options) for the /var/log/audit partition.

### Command Line

Example:

```
<device> /var/log/audit <fstype> defaults,rw,nosuid,nodev,noexec,relatime 0 0
```

Run the following command to remount /var/log/audit with the configured options:

```bash
# mount -o remount /var/log/audit
```

## References

1. See the fstab(5) manual page for more information.
2. NIST SP 800-53 Rev. 5: AC-3, MP-2
3. NIST SP 800-53 Revision 5 :: CM-7 (2)
4. STIG ID: RHEL-08-040131 | RULE ID: SV-230519r958804 | CAT II
5. STIG ID: RHEL-09-231165 | RULE ID: SV-257874r958804 | CAT II

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br/>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1204, T1204.002            | TA0005  | M1022       |
