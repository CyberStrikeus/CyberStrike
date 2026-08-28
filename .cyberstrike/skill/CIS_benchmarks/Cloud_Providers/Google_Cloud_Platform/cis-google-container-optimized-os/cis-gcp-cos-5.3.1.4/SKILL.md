---
name: cis-gcp-cos-5.3.1.4
description: "Ensure inactive password lock is 30 days or less"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, shadow, password-expiration, user-accounts]
cis_id: "5.3.1.4"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.1.4 Ensure inactive password lock is 30 days or less (Automated)

## Description

User accounts that have been inactive for over a given period of time can be automatically disabled. It is recommended that accounts that are inactive for 30 days after password expiration be disabled.

## Rationale

Inactive accounts pose a threat to system security since the users are not logging in to notice failed login attempts or other anomalies.

## Audit Procedure

Run the following command and verify `INACTIVE` conforms to site policy (no more than 30 days):

```bash
# useradd -D | grep INACTIVE

INACTIVE=30
```

Verify all users with a password have Password inactive no more than 30 days after password expires:

Run the following command and Review list of users and INACTIVE to verify that all users' INACTIVE conforms to site policy (no more than 30 days):

```bash
# grep -E '^[^:]+:[^\!*]' /etc/shadow | cut -d: -f1,7

<user>:<INACTIVE>
```

## Expected Result

`INACTIVE` should be 30 or less from `useradd -D` and for all users with a password in `/etc/shadow`.

## Remediation

Run the following command to set the default password inactivity period to 30 days:

```bash
# useradd -D -f 30
```

Modify user parameters for all users with a password set to match:

```bash
# chage --inactive 30 <user>
```

Additional Information:

You can also check this setting in `/etc/shadow` directly. The 7th field should be 30 or less for all users with a password.

Note: A value of -1 would disable this setting.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | **5.2 Use Unique Passwords** - Use unique passwords for all enterprise assets. Best practice implementation includes, at a minimum, an 8-character password for accounts using MFA and a 14-character password for accounts not using MFA. | x    | x    | x    |
| v7               | **4.4 Use Unique Passwords** - Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system.                                    |      | x    | x    |

## Profile

- Level 2 - Server
