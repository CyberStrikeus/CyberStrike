---
name: cis-ubuntu1604-v200-5-5-1-1
description: "Ensure minimum days between password changes is configured"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, authentication, pam]
cis_id: "5.5.1.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure minimum days between password changes is configured

**Profile Applicability:**

- Level 1 - Server
- Level 1 - Workstation

**Assessment Status:** Automated

## Description

The `PASS_MIN_DAYS` parameter in `/etc/login.defs` allows an administrator to prevent users from changing their password until a minimum number of days have passed since the last time the user changed their password. It is recommended that `PASS_MIN_DAYS` parameter be set to 1 or more days.

## Rationale

By restricting the frequency of password changes, an administrator can prevent users from repeatedly changing their password in an attempt to circumvent password reuse controls.

## Audit Procedure

### Command Line

Run the following command and verify `PASS_MIN_DAYS` conforms to site policy (no less than 1 day):

```bash
grep PASS_MIN_DAYS /etc/login.defs
```

**Expected output:**

```
PASS_MIN_DAYS 1
```

Run the following command and Review list of users and PAS_MIN_DAYS to Verify that all users' PAS_MIN_DAYS conforms to site policy (no less than 1 day):

```bash
awk -F : '(/^[^:]+:[^!*]/ && $4 < 1){print $1 " " $4}' /etc/shadow
```

**Expected Result:**

No `<user>:<PASS_MIN_DAYS>` should be returned.

## Remediation

### Command Line

Set the `PASS_MIN_DAYS` parameter to 1 in `/etc/login.defs`:

```
PASS_MIN_DAYS 1
```

Modify user parameters for all users with a password set to match:

```bash
chage --mindays 1 <user>
```

## Default Value

PASS_MIN_DAYS 0

## References

None

## CIS Controls

| Controls Version | Control                                                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v6               | 16 Account Monitoring and Control - Account Monitoring and Control                                                                                                                                  |
| v7               | 4.4 Use Unique Passwords - Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system. |

## Profile

- **Level 1 - Server**
- **Level 1 - Workstation**
