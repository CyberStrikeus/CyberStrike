---
name: cis-ubuntu1204-v110-10-1-1
description: "Set Password Expiration Days"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, password, expiration, login-defs, authentication]
cis_id: "10.1.1"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.1.1 Set Password Expiration Days (Scored)

## Profile Applicability

- Level 1

## Description

The `PASS_MAX_DAYS` parameter in `/etc/login.defs` allows an administrator to force passwords to expire once they reach a defined age. It is recommended that the `PASS_MAX_DAYS` parameter be set to less than or equal to 90 days.

## Rationale

The window of opportunity for an attacker to leverage compromised credentials or successfully compromise credentials via an online brute force attack is limited by the age of the password. Therefore, reducing the maximum age of a password also reduces an attacker's window of opportunity.

## Audit Procedure

### Using Command Line

```bash
grep PASS_MAX_DAYS /etc/login.defs
# Expected output: PASS_MAX_DAYS 90

chage --list <user>
# Verify: Maximum number of days between password change: 90
```

## Expected Result

`PASS_MAX_DAYS` is set to 90 or less in `/etc/login.defs`, and all active users have a maximum password age of 90 days or less.

## Remediation

### Using Command Line

Set the `PASS_MAX_DAYS` parameter to 90 in `/etc/login.defs`:

```bash
# Edit /etc/login.defs and set:
PASS_MAX_DAYS 90

# Modify active user parameters to match:
chage --maxdays 90 <user>
```

## Default Value

PASS_MAX_DAYS 99999

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
