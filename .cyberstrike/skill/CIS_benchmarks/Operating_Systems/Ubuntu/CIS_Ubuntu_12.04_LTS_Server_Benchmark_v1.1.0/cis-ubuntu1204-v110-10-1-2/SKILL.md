---
name: cis-ubuntu1204-v110-10-1-2
description: "Set Password Change Minimum Number of Days"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, password, minimum-days, login-defs, authentication]
cis_id: "10.1.2"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.1.2 Set Password Change Minimum Number of Days (Scored)

## Profile Applicability
- Level 1

## Description
The `PASS_MIN_DAYS` parameter in `/etc/login.defs` allows an administrator to prevent users from changing their password until a minimum number of days have passed since the last time the user changed their password. It is recommended that `PASS_MIN_DAYS` parameter be set to 7 or more days.

## Rationale
By restricting the frequency of password changes, an administrator can prevent users from repeatedly changing their password in an attempt to circumvent password reuse controls.

## Audit Procedure
### Using Command Line
```bash
grep PASS_MIN_DAYS /etc/login.defs
# Expected output: PASS_MIN_DAYS 7

chage --list <user>
# Verify: Minimum number of days between password change: 7
```

## Expected Result
`PASS_MIN_DAYS` is set to 7 or more in `/etc/login.defs`, and all active users have a minimum password age of 7 days or more.

## Remediation
### Using Command Line
Set the `PASS_MIN_DAYS` parameter to 7 in `/etc/login.defs`:
```bash
# Edit /etc/login.defs and set:
PASS_MIN_DAYS 7

# Modify active user parameters to match:
chage --mindays 7 <user>
```

## Default Value
PASS_MIN_DAYS 0

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
