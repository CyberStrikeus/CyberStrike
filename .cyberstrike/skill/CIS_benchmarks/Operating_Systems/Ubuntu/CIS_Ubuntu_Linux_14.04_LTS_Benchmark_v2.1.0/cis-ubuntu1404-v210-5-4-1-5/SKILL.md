---
name: "CIS Ubuntu 14.04 LTS - 5.4.1.5 Ensure all users last password change date is in the past"
description: "Verify no users have a password change date set in the future which could bypass expiration"
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
cis_id: "5.4.1.5"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 5.4.1.5 Ensure all users last password change date is in the past (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

All users should have a password change date in the past.

## Rationale

If a users recorded password change date is in the future then they could bypass any set password expiration.

## Audit Procedure

Verify no users with a have Password change date in the future:

```bash
cat /etc/shadow | cut -d: -f1
chage --list <user>
```

## Expected Result

```
Last Change                                             : <date in the past>
```

## Remediation

Investigate any users with a password change date in the future and correct them. Locking the account, expiring the password, or resetting the password manually may be appropriate.

## Default Value

Password change date is set to current date when password is changed.

## References

- CIS Controls: 16 - Account Monitoring and Control

## Profile

- Level 1 - Server
- Level 1 - Workstation
