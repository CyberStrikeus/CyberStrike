---
name: cis-gcp-cos-5.3.1.3
description: "Ensure password expiration warning days is 7 or more"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, shadow, password-expiration, user-accounts]
cis_id: "5.3.1.3"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.1.3 Ensure password expiration warning days is 7 or more (Automated)

## Description

The `PASS_WARN_AGE` parameter in `/etc/login.defs` allows an administrator to notify users that their password will expire in a defined number of days. It is recommended that the `PASS_WARN_AGE` parameter be set to 7 or more days.

## Rationale

Providing an advance warning that a password will be expiring gives users time to think of a secure password. Users caught unaware may choose a simple password or write it down where it may be discovered.

## Audit Procedure

Run the following command and verify `PASS_WARN_AGE` conforms to site policy (No less than 7 days):

```bash
# grep PASS_WARN_AGE /etc/login.defs

PASS_WARN_AGE 7
```

Verify all users with a password have their number of days of warning before password expires set to 7 or more:

Run the following command and Review list of users and PASS_WARN_AGE to verify that all users' `PASS_WARN_AGE` conforms to site policy (No less than 7 days):

```bash
# grep -E '^[^:]+:[^\!*]' /etc/shadow | cut -d: -f1,6

<user>:<PASS_WARN_AGE>
```

## Expected Result

`PASS_WARN_AGE` should be 7 or more in `/etc/login.defs` and for all users with a password in `/etc/shadow`.

## Remediation

Set the `PASS_WARN_AGE` parameter to 7 in `/etc/login.defs`:

```
PASS_WARN_AGE 7
```

Modify user parameters for all users with a password set to match:

```bash
# chage --warndays 7 <user>
```

Additional Information:

You can also check this setting in `/etc/shadow` directly. The 6th field should be 7 or more for all users with a password.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | **5.2 Use Unique Passwords** - Use unique passwords for all enterprise assets. Best practice implementation includes, at a minimum, an 8-character password for accounts using MFA and a 14-character password for accounts not using MFA. | x    | x    | x    |
| v7               | **4.4 Use Unique Passwords** - Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system.                                    |      | x    | x    |

## Profile

- Level 1 - Server
