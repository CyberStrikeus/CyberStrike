---
name: cis-ubuntu1804-v220-4-5-2
description: "Ensure system accounts are secured"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, users, account-security]
cis_id: "4.5.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.5.2

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

There are a number of accounts provided with most distributions that are used to manage applications and are not intended to provide an interactive shell.

## Rationale

It is important to make sure that accounts that are not being used by regular users are prevented from being used to provide an interactive shell. By default, most distributions set the password field for these accounts to an invalid string, but it is also recommended that the shell field in the password file be set to the `nologin` shell. This prevents the account from potentially being used to run any commands.

## Audit Procedure

### Command Line

Run the following script to verify all local system accounts:

- Do not have a valid login shell
- Are locked

```bash
#!/usr/bin/env bash
{
  l_output="" l_output2=""
  l_valid_shells="$($(awk -F\/ '$NF != "nologin" {print}' /etc/shells | sed -rn '/^\//{s,/,\\/,g;p}' | paste -s -d '|' - )$"
  a_users=(); a_ulock=()
  while read -r l_user; do
    a_users+=("$l_user")
  done < <(awk -v pat="$l_valid_shells" -F: '($1!~/^(root|sync|shutdown|halt)^\+/) && $3<'"$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)"' && $(NF) ~ pat { print $1 }' /etc/passwd)
  while read -r l_ulock; do
    a_ulock+=("$l_ulock")
  done < <(awk -v pat="$l_valid_shells" -F: '($1!~/^(root)^\+/) && $2!~/LK?/ && $3<'"$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)"' && $(NF) ~ pat { print $1 }' /etc/passwd)
  if ! (( ${#a_users[@]} > 0 )); then
    l_output="$l_output\n - local system accounts login is disabled"
  else
    l_output2="$l_output2\n - There are \"$(printf '%s' "${#a_users[@]}")\" system accounts with login enabled\n - List of accounts:\n$(printf '%s\n' "${a_users[@]:0:$l_limit}")\n  - end of list\n"
  fi
  if ! (( ${#a_ulock[@]} > 0 )); then
    l_output="$l_output\n - local system accounts are locked"
  else
    l_output2="$l_output2\n - There are \"$(printf '%s' "${#a_ulock[@]}")\" system accounts that are not locked\n - List of accounts:\n$(printf '%s\n' "${a_ulock[@]:0:$l_limit}")\n  - end of list\n"
  fi
  if [ -z "$l_output2" ]; then
    echo -e "\n- Audit Result:\n  ** PASS **\n - Correctly configured * :$l_output\n"
  else
    echo -e "\n- Audit Result:\n  ** FAIL **\n - Reasons for audit failure * :$l_output2"
    [ -n "$l_output" ] && echo -e "- * Correctly configured * :$l_output\n"
  fi
}
```

Note: The `root`, `sync`, `shutdown`, and `halt` users are exempted from requiring a non-login shell. `root` is exempt from being locked.

### Expected Result

```
** PASS ** - Correctly configured
```

## Remediation

### Command Line

Set the shell for any accounts returned by the audit to nologin:

```bash
usermod -s $(which nologin) <user>
```

Lock any non root accounts returned by the audit:

```bash
usermod -L <user>
```

## References

1. NIST SP 800-53 Rev. 5: AC-2. AC-3, AC-5, MP-2

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know.

v7 - 14.6 Protect Information through Access Control Lists.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
