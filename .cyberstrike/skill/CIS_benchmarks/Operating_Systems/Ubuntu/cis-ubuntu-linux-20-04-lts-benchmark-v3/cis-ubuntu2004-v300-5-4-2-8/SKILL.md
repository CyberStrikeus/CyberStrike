---
name: cis-ubuntu2004-v300-5-4-2-8
description: "Ensure accounts without a valid login shell are locked"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, users, authentication]
cis_id: "5.4.2.8"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.2.8 Ensure accounts without a valid login shell are locked (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

There are a number of accounts provided with most distributions that are used to manage applications and are not intended to provide an interactive shell. Furthermore, a user may add special accounts that are not intended to provide an interactive shell.

## Rationale

It is important to make sure that accounts that are not being used by regular users are prevented from being used to provide an interactive shell. By default, most distributions set the password field for these accounts to an invalid string, but it is also recommended that the shell field in the password file be set to the `nologin` shell. This prevents the account from potentially being used to run any commands.

## Audit Procedure

### Command Line

Run the following script to verify all non-root accounts without a valid login shell are locked.

```bash
#!/usr/bin/env bash

{
  l_valid_shells="^($(awk -F\/ '$NF != "nologin" {print}' /etc/shells | sed -rn '/^\//!d;s,/,\\\\/,g;p' | paste -s -d '|' - ))$"
  while IFS= read -r l_user; do
    passwd -S "$l_user" | awk '$2 !~ /^L/ {print "Account: \"" $1 "\" does not have a valid login shell and is not locked"}'
  done < <(awk -v pat="$l_valid_shells" -F: '($1 != "root" && $(NF) !~ pat) {print $1}' /etc/passwd)
}
```

## Expected Result

Nothing should be returned

## Remediation

### Command Line

Run the following command to lock any non-root accounts without a valid login shell returned by the audit:

```bash
# usermod -L <user>
```

Example script::

```bash
#!/usr/bin/env bash

{
  l_valid_shells="^($(awk -F\/ '$NF != "nologin" {print}' /etc/shells | sed -rn '/^\//!d;s,/,\\\\/,g;p' | paste -s -d '|' - ))$"
  while IFS= read -r l_user; do
    passwd -S "$l_user" | awk '$2 !~ /^L/ {system ("usermod -L " $1)}'
  done < <(awk -v pat="$l_valid_shells" -F: '($1 != "root" && $(NF) !~ pat) {print $1}' /etc/passwd)
}
```

## Default Value

None specified.

## References

1. NIST SP 800-53 Rev. 5: AC-2(5), AC-3, AC-11, MP-2

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists: Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. (IG 1, IG 2, IG 3)

v7 - 14.6 Protect Information through Access Control Lists: Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. (IG 1, IG 2, IG 3)

MITRE ATT&CK Mappings: T1078, T1078.001, T1078.003 - Tactics: TA0005 - Mitigations: M1026
