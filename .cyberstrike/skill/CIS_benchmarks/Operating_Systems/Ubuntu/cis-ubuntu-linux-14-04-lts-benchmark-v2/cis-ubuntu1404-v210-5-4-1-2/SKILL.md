---
name: "CIS Ubuntu 14.04 LTS - 5.4.1.2 Ensure minimum days between password changes is 7 or more"
description: "Verify PASS_MIN_DAYS is set to 7 or more in /etc/login.defs to prevent rapid password cycling"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - user-accounts
cis_id: "5.4.1.2"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 5.4.1.2 Ensure minimum days between password changes is 7 or more (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `PASS_MIN_DAYS` parameter in `/etc/login.defs` allows an administrator to prevent users from changing their password until a minimum number of days have passed since the last time the user changed their password. It is recommended that `PASS_MIN_DAYS` parameter be set to 7 or more days.

## Rationale

By restricting the frequency of password changes, an administrator can prevent users from repeatedly changing their password in an attempt to circumvent password reuse controls.

## Audit Procedure

Run the following command and verify `PASS_MIN_DAYS` is 7 or more:

```bash
grep PASS_MIN_DAYS /etc/login.defs
```

Verify all users with a password have their minimum days between password change set to 7 or more:

```bash
egrep ^[^:]+:[^\!*] /etc/shadow | cut -d: -f1
chage --list <user>
```

## Expected Result

```
PASS_MIN_DAYS 7
Minimum number of days between password change          : 7
```

## Remediation

Set the `PASS_MIN_DAYS` parameter to 7 in `/etc/login.defs`:

```
PASS_MIN_DAYS 7
```

Modify user parameters for all users with a password set to match:

```bash
chage --mindays 7 <user>
```

## Default Value

PASS_MIN_DAYS 0

## References

- CIS Controls: 16 - Account Monitoring and Control

## Profile

- Level 1 - Server
- Level 1 - Workstation
