---
name: cis-ubuntu1604-v200-5-5-1-2
description: "Ensure password expiration is 365 days or less"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, authentication, pam]
cis_id: "5.5.1.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure password expiration is 365 days or less

**Profile Applicability:**
- Level 1 - Server
- Level 1 - Workstation

**Assessment Status:** Automated

## Description

The `PASS_MAX_DAYS` parameter in `/etc/login.defs` allows an administrator to force passwords to expire once they reach a defined age.

## Rationale

The window of opportunity for an attacker to leverage compromised credentials or successfully compromise credentials via an online brute force attack is limited by the age of the password. Therefore, reducing the maximum age of a password also reduces an attacker's window of opportunity. It is recommended that the `PASS_MAX_DAYS` parameter does not exceed 365 days and is greater than the value of `PASS_MIN_DAYS`.

## Audit Procedure

### Command Line

Run the following command and verify `PASS_MAX_DAYS` conforms to site policy, does not exceed 365 days, and is greater than `PASS_MIN_DAYS`:

```bash
grep PASS_MAX_DAYS /etc/login.defs
```

**Expected output:**

```
PASS_MAX_DAYS 365
```

Run the following command and Review list of users and `PASS_MAX_DAYS` to verify that all users' `PASS_MAX_DAYS` conforms to site policy, does not exceed 365 days, and is no less than `PASS_MIN_DAYS`:

```bash
awk -F: '(/^[^:]+:[^!*]/ && ($5>365 || $5~/([0-1]|-1|\s*)/)){print $1 " " $5}' /etc/shadow
```

**Expected Result:**

No `<user>:<PASS_MAX_DAYS>` should be returned.

## Remediation

### Command Line

Set the `PASS_MAX_DAYS` parameter to conform to site policy in `/etc/login.defs`:

```
PASS_MAX_DAYS 365
```

Modify user parameters for all users with a password set to match:

```bash
chage --maxdays 365 <user>
```

## Default Value

PASS_MAX_DAYS 99999

## References

1. https://www.cisecurity.org/white-papers/cis-password-policy-guide/

## Additional Information

A value of -1 will disable password expiration.

The password expiration must be greater than the minimum days between password changes or users will be unable to change their password.

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 4.4 Use Unique Passwords - Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system. |

## Profile

- **Level 1 - Server**
- **Level 1 - Workstation**
