---
name: cis-ubuntu1804-v220-4-5-1-5
description: "Ensure all users last password change date is in the past"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, users, password-policy]
cis_id: "4.5.1.5"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.5.1.5

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

All users should have a password change date in the past.

## Rationale

If a users recorded password change date is in the future then they could bypass any set password expiration.

## Audit Procedure

### Command Line

Run the following script to verify all users last password change was in the past:

```bash
#!/usr/bin/env bash
{
  l_output2=""
  while read -r l_user; do
    l_change="$(chage --list $l_user | awk -F: '($1 ~ /^\s*Last\s+password\s+change/ && $2 !~ /never/){print $2}' | xargs)"
    if [[ "$(date -d "$l_change" +%s)" -gt "$(date +%s)" ]]; then
      l_output2="$l_output2\n - User: \"$l_user\" last password change is in the future \"$l_change\""
    fi
  done < <(awk -F: '($2 ~ /^[^*!xX\n\r]/{print $1}' /etc/shadow)
  if [ -z "$l_output2" ]; then
    echo -e "\n- Audit Result:\n  ** PASS **\n - All user password changes are in the past \n"
  else
    echo -e "\n- Audit Result:\n  ** FAIL **\n - Reasons for audit failure :$l_output2\n"
  fi
}
```

### Expected Result

```
** PASS ** - All user password changes are in the past
```

## Remediation

### Command Line

Investigate any users with a password change date in the future and correct them. Locking the account, expiring the password, or resetting the password manually may be appropriate.

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
