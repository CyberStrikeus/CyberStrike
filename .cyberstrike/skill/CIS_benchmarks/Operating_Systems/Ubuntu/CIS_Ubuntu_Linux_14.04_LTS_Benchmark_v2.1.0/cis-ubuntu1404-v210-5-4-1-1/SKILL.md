---
name: "CIS Ubuntu 14.04 LTS - 5.4.1.1 Ensure password expiration is 365 days or less"
description: "Verify PASS_MAX_DAYS is set to 365 or less in /etc/login.defs for password expiration"
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
cis_id: "5.4.1.1"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 5.4.1.1 Ensure password expiration is 365 days or less (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `PASS_MAX_DAYS` parameter in `/etc/login.defs` allows an administrator to force passwords to expire once they reach a defined age. It is recommended that the `PASS_MAX_DAYS` parameter be set to less than or equal to 365 days.

## Rationale

The window of opportunity for an attacker to leverage compromised credentials or successfully compromise credentials via an online brute force attack is limited by the age of the password. Therefore, reducing the maximum age of a password also reduces an attacker's window of opportunity.

## Audit Procedure

Run the following command and verify `PASS_MAX_DAYS` conforms to site policy (no more than 365 days):

```bash
grep PASS_MAX_DAYS /etc/login.defs
```

Verify all users with a password maximum days between password change conforms to site policy (no more than 365 days):

```bash
egrep ^[^:]+:[^\!*] /etc/shadow | cut -d: -f1
chage --list <user>
```

## Expected Result

```
PASS_MAX_DAYS 90
Maximum number of days between password change          : 90
```

## Remediation

Set the `PASS_MAX_DAYS` parameter to conform to site policy in `/etc/login.defs`:

```
PASS_MAX_DAYS 90
```

Modify user parameters for all users with a password set to match:

```bash
chage --maxdays 90 <user>
```

## Default Value

PASS_MAX_DAYS 99999

## References

- CIS Controls: 16 - Account Monitoring and Control

## Profile

- Level 1 - Server
- Level 1 - Workstation
