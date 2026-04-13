---
name: cis-gcp-cos-5.3.1.5
description: "Ensure all users last password change date is in the past"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, shadow, password-expiration, user-accounts]
cis_id: "5.3.1.5"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.1.5 Ensure all users last password change date is in the past (Automated)

## Description

All users should have a password change date in the past.

## Rationale

If a users recorded password change date is in the future then they could bypass any set password expiration.

## Audit Procedure

Run the following command and verify nothing is returned:

```bash
# for usr in $(cut -d: -f1 /etc/shadow); do [[ $(chage --list $usr | grep '^Last password change' | cut -d: -f2) > $(date) ]] && echo "$usr :$(chage --list $usr | grep '^Last password change' | cut -d: -f2)"; done
```

## Expected Result

No output should be returned. If any users are listed, their last password change date is set in the future.

## Remediation

Investigate any users with a password change date in the future and correct them. Locking the account, expiring the password, or resetting the password manually may be appropriate.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                    | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | **5.2 Use Unique Passwords** - Use unique passwords for all enterprise assets. Best practice implementation includes, at a minimum, an 8-character password for accounts using MFA and a 14-character password for accounts not using MFA. | x    | x    | x    |
| v7               | **4.4 Use Unique Passwords** - Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system.                                    |      | x    | x    |

## Profile

- Level 1 - Server
