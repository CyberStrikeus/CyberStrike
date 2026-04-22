---
name: cis-ubuntu2004-v300-5-4-1-6
description: "Ensure all users last password change date is in the past"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, users, authentication]
cis_id: "5.4.1.6"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.1.6 Ensure all users last password change date is in the past (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

All users should have a password change date in the past.

## Rationale

If a user's recorded password change date is in the future, then they could bypass any set password expiration.

## Audit Procedure

### Command Line

Run the following script and verify nothing is returned:

```bash
#!/usr/bin/env bash

{
  while IFS= read -r l_user; do
    l_change=$(date -d "$(chage --list $l_user | grep '^Last password change' | cut -d: -f2 | grep -v 'never$')" +%s)
    if [[ "$l_change" -gt "$(date +%s)" ]]; then
      echo "User: \"$l_user\" last password change was \"$(chage --list $l_user | grep '^Last password change' | cut -d: -f2)\""
    fi
  done < <(awk -F: '$2~/^\$.+\$/{print $1}' /etc/shadow)
}
```

## Expected Result

Nothing should be returned

## Remediation

### Command Line

Investigate any users with a password change date in the future and correct them. Locking the account, expiring the password, or resetting the password manually may be appropriate.

## Default Value

None specified.

## References

None specified.

## CIS Controls

v8 - 5.2 Use Unique Passwords: Use unique passwords for all enterprise assets. Best practice implementation includes, at a minimum, an 8-character password for accounts using MFA and a 14-character password for accounts not using MFA. (IG 1, IG 2, IG 3)

v7 - 4.4 Use Unique Passwords: Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system. (IG 2, IG 3)

MITRE ATT&CK Mappings: T1078, T1078.001, T1078.002, T1078.003, T1078.004, T1110, T1110.001, T1110.002, T1110.003, T1110.004
