---
name: cis-ubuntu1604-v200-5-5-1-5
description: "Ensure all users last password change date is in the past"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, authentication, pam]
cis_id: "5.5.1.5"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure all users last password change date is in the past

**Profile Applicability:**
- Level 1 - Server
- Level 1 - Workstation

**Assessment Status:** Automated

## Description

All users should have a password change date in the past.

## Rationale

If a users recorded password change date is in the future then they could bypass any set password expiration.

## Audit Procedure

### Command Line

Run the following command and verify nothing is returned:

```bash
awk -F : '/^[^:]+:[^!*]/{print $1}' /etc/shadow | while read -r usr; do [ "$(date --date="$(chage --list "$usr" | grep '^Last password change' | cut -d: -f2)" +%s)" -gt "$(date "+%s")" ] && echo "user: $usr password change date: $(chage --list "$usr" | grep '^Last password change' | cut -d: -f2)"; done
```

**Expected Result:**

Nothing should be returned.

## Remediation

### Command Line

Investigate any users with a password change date in the future and correct them. Locking the account, expiring the password, or resetting the password manually may be appropriate.

## References

None

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 4.4 Use Unique Passwords - Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system. |

## Profile

- **Level 1 - Server**
- **Level 1 - Workstation**
