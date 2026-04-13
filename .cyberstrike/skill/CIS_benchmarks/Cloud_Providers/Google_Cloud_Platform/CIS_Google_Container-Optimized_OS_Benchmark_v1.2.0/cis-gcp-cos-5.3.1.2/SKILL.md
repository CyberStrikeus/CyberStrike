---
name: cis-gcp-cos-5.3.1.2
description: "Ensure minimum days between password changes is 7 or more"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, shadow, password-expiration, user-accounts]
cis_id: "5.3.1.2"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.1.2 Ensure minimum days between password changes is 7 or more (Automated)

## Description

The `PASS_MIN_DAYS` parameter in `/etc/login.defs` allows an administrator to prevent users from changing their password until a minimum number of days have passed since the last time the user changed their password. It is recommended that `PASS_MIN_DAYS` parameter be set to 7 or more days.

## Rationale

By restricting the frequency of password changes, an administrator can prevent users from repeatedly changing their password in an attempt to circumvent password reuse controls.

## Audit Procedure

Run the following command and verify `PASS_MIN_DAYS` conforms to site policy (no less than 7 days):

```bash
# grep PASS_MIN_DAYS /etc/login.defs

PASS_MIN_DAYS 7
```

Run the following command and Review list of users and PASS_MIN_DAYS to Verify that all users' PASS_MIN_DAYS conforms to site policy (no less than 7 days):

```bash
# grep -E '^[^:]+:[^\!*]' /etc/shadow | cut -d: -f1,4

<user>:<PASS_MIN_DAYS>
```

## Expected Result

`PASS_MIN_DAYS` should be 7 or more in `/etc/login.defs` and for all users with a password in `/etc/shadow`.

## Remediation

Set the `PASS_MIN_DAYS` parameter to 7 in `/etc/login.defs`:

```
PASS_MIN_DAYS 7
```

Modify user parameters for all users with a password set to match:

```bash
# chage --mindays 7 <user>
```

Additional Information:

You can also check this setting in `/etc/shadow` directly. The 4th field should be 7 or more for all users with a password.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | **5.2 Use Unique Passwords** - Use unique passwords for all enterprise assets. Best practice implementation includes, at a minimum, an 8-character password for accounts using MFA and a 14-character password for accounts not using MFA. | x    | x    | x    |
| v7               | **4.4 Use Unique Passwords** - Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system.                                    |      | x    | x    |

## Profile

- Level 2 - Server
