---
name: cis-ubuntu1604-v200-5-5-1-3
description: "Ensure password expiration warning days is 7 or more"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, authentication, pam]
cis_id: "5.5.1.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure password expiration warning days is 7 or more

**Profile Applicability:**
- Level 1 - Server
- Level 1 - Workstation

**Assessment Status:** Automated

## Description

The `PASS_WARN_AGE` parameter in `/etc/login.defs` allows an administrator to notify users that their password will expire in a defined number of days. It is recommended that the `PASS_WARN_AGE` parameter be set to 7 or more days.

## Rationale

Providing an advance warning that a password will be expiring gives users time to think of a secure password. Users caught unaware may choose a simple password or write it down where it may be discovered.

## Audit Procedure

### Command Line

Run the following command and verify `PASS_WARN_AGE` conforms to site policy (No less than 7 days):

```bash
grep PASS_WARN_AGE /etc/login.defs
```

**Expected output:**

```
PASS_WARN_AGE 7
```

Verify all users with a password have their number of days of warning before password expires set to 7 or more. Run the following command and Review list of users and `PASS_WARN_AGE` to verify that all users' `PASS_WARN_AGE` conforms to site policy (No less than 7 days):

```bash
awk -F: '(/^[^:]+:[^!*]/ && $6<7){print $1 " " $6}' /etc/shadow
```

**Expected Result:**

No `<user>:<PASS_WARN_AGE>` should be returned.

## Remediation

### Command Line

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

None

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 4.4 Use Unique Passwords - Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system. |

## Profile

- **Level 1 - Server**
- **Level 1 - Workstation**
