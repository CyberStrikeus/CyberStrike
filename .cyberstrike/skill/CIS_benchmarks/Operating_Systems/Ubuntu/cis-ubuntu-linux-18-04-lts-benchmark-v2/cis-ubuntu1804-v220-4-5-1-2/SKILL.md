---
name: cis-ubuntu1804-v220-4-5-1-2
description: "Ensure password expiration is 365 days or less"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, users, password-policy]
cis_id: "4.5.1.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.5.1.2

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `PASS_MAX_DAYS` parameter in `/etc/login.defs` allows an administrator to force passwords to expire once they reach a defined age. It is recommended that the `PASS_MAX_DAYS` parameter be set to less than or equal to 365 days.

## Rationale

The window of opportunity for an attacker to leverage compromised credentials or successfully compromise credentials via an online brute force attack is limited by the age of the password. Therefore, reducing the maximum age of a password also reduces an attacker's window of opportunity.

## Audit Procedure

### Command Line

Run the following command and verify `PASS_MAX_DAYS` is 365 or less:

```bash
grep -Pi '^\h*PASS_MAX_DAYS\h+\d+\b' /etc/login.defs
```

Verify all users with a password have the maximum days set:

```bash
awk -F: '($2~/^\$.+\$/){print $1 " " $5}' /etc/shadow
```

### Expected Result

`PASS_MAX_DAYS` should be `365` or less, but not `0` in `/etc/login.defs`.

No user should have a value greater than `365` in field 5 of `/etc/shadow`.

## Remediation

### Command Line

Set the `PASS_MAX_DAYS` parameter to conform to site policy in `/etc/login.defs`:

```bash
PASS_MAX_DAYS 365
```

Modify user parameters for all users with a password set to match:

```bash
chage --maxdays 365 <user>
```

## Default Value

PASS_MAX_DAYS 99999

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
