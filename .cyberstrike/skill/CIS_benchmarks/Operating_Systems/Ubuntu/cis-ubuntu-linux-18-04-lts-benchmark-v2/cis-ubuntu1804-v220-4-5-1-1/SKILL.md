---
name: cis-ubuntu1804-v220-4-5-1-1
description: "Ensure minimum days between password changes is configured"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, users, password-policy]
cis_id: "4.5.1.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.5.1.1

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `PASS_MIN_DAYS` parameter in `/etc/login.defs` allows an administrator to prevent users from changing their password until a minimum number of days have passed since the last time the user changed their password. It is recommended that `PASS_MIN_DAYS` parameter be set to 1 or more days.

## Rationale

By restricting the frequency of password changes, an administrator can prevent users from repeatedly changing their password in an attempt to circumvent password reuse controls.

## Audit Procedure

### Command Line

Run the following command and verify `PASS_MIN_DAYS` is 1 or more:

```bash
grep -Pi '^\h*PASS_MIN_DAYS\h+\d+\b' /etc/login.defs
```

Verify all users with a password have their minimum days set:

```bash
awk -F: '($2~/^\$.+\$/){print $1 " " $4}' /etc/shadow
```

### Expected Result

`PASS_MIN_DAYS` should be `1` or more in `/etc/login.defs`.

No user should have a value less than `1` in field 4 of `/etc/shadow`.

## Remediation

### Command Line

Set the `PASS_MIN_DAYS` parameter to 1 in `/etc/login.defs`:

```bash
PASS_MIN_DAYS 1
```

Modify user parameters for all users with a password set to match:

```bash
chage --mindays 1 <user>
```

## Default Value

PASS_MIN_DAYS 0

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
