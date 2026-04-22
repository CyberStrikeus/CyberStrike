---
name: cis-ubuntu1804-v220-4-5-1-3
description: "Ensure password expiration warning days is 7 or more"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, users, password-policy]
cis_id: "4.5.1.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.5.1.3

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `PASS_WARN_AGE` parameter in `/etc/login.defs` allows an administrator to notify users that their password will expire in a defined number of days. It is recommended that the `PASS_WARN_AGE` parameter be set to 7 or more days.

## Rationale

Providing an advance warning that a password will be expiring gives users time to think of a secure password. Users caught unaware may choose a simple password or write it down where it may be discovered.

## Audit Procedure

### Command Line

Run the following command and verify `PASS_WARN_AGE` is 7 or more:

```bash
grep -Pi '^\h*PASS_WARN_AGE\h+\d+\b' /etc/login.defs
```

Verify all users with a password have their warning days set:

```bash
awk -F: '($2~/^\$.+\$/){print $1 " " $6}' /etc/shadow
```

### Expected Result

`PASS_WARN_AGE` should be `7` or more in `/etc/login.defs`.

No user should have a value less than `7` in field 6 of `/etc/shadow`.

## Remediation

### Command Line

Set the `PASS_WARN_AGE` parameter to 7 in `/etc/login.defs`:

```bash
PASS_WARN_AGE 7
```

Modify user parameters for all users with a password set to match:

```bash
chage --warndays 7 <user>
```

## Default Value

PASS_WARN_AGE 7

## References

1. NIST SP 800-53 Rev. 5: IA-5, CM-6

## CIS Controls

v8 - 5.2 Use Unique Passwords - Use unique passwords for all enterprise assets.

v7 - 4.4 Use Unique Passwords.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
