---
name: cis-ubuntu1804-v220-4-5-1-4
description: "Ensure inactive password lock is 30 days or less"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, users, password-policy]
cis_id: "4.5.1.4"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.5.1.4

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

User accounts that have been inactive for an extended period of time pose a security risk. An attacker could use an inactive account to gain access to the system without being detected. It is recommended that inactive accounts be locked after 30 days.

## Rationale

Inactive accounts pose a threat to system security since the users are not logging in to notice failed login attempts or other anomalies.

## Audit Procedure

### Command Line

Run the following command and verify `INACTIVE` is 30 or less:

```bash
useradd -D | grep INACTIVE
```

Verify all users with a password have their inactive period set:

```bash
awk -F: '($2~/^\$.+\$/){print $1 " " $7}' /etc/shadow
```

### Expected Result

`INACTIVE=30` or less, but not `-1`.

No user should have a value greater than `30` or `-1` in field 7 of `/etc/shadow`.

## Remediation

### Command Line

Set the default inactive period:

```bash
useradd -D -f 30
```

Modify user parameters for all users with a password set to match:

```bash
chage --inactive 30 <user>
```

## Default Value

INACTIVE=-1

## References

1. NIST SP 800-53 Rev. 5: IA-5

## CIS Controls

v8 - 5.2 Use Unique Passwords - Use unique passwords for all enterprise assets.

v7 - 4.4 Use Unique Passwords.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
