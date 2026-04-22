---
name: "CIS Ubuntu 14.04 LTS - 5.4.1.3 Ensure password expiration warning days is 7 or more"
description: "Verify PASS_WARN_AGE is set to 7 or more in /etc/login.defs for password expiry warnings"
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
cis_id: "5.4.1.3"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 5.4.1.3 Ensure password expiration warning days is 7 or more (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `PASS_WARN_AGE` parameter in `/etc/login.defs` allows an administrator to notify users that their password will expire in a defined number of days. It is recommended that the `PASS_WARN_AGE` parameter be set to 7 or more days.

## Rationale

Providing an advance warning that a password will be expiring gives users time to think of a secure password. Users caught unaware may choose a simple password or write it down where it may be discovered.

## Audit Procedure

Run the following command and verify `PASS_WARN_AGE` is 7 or more:

```bash
grep PASS_WARN_AGE /etc/login.defs
```

Verify all users with a password have their number of days of warning before password expires set to 7 or more:

```bash
egrep ^[^:]+:[^\!*] /etc/shadow | cut -d: -f1
chage --list <user>
```

## Expected Result

```
PASS_WARN_AGE 7
Number of days of warning before password expires       : 7
```

## Remediation

Set the `PASS_WARN_AGE` parameter to 7 in `/etc/login.defs`:

```
PASS_WARN_AGE 7
```

Modify user parameters for all users with a password set to match:

```bash
chage --warndays 7 <user>
```

## Default Value

PASS_WARN_AGE 7

## References

- CIS Controls: 16 - Account Monitoring and Control

## Profile

- Level 1 - Server
- Level 1 - Workstation
