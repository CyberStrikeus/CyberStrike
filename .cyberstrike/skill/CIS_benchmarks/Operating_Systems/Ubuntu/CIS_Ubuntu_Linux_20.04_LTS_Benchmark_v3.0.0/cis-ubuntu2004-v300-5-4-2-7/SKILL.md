---
name: cis-ubuntu2004-v300-5-4-2-7
description: "Ensure system accounts do not have a valid login shell"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, users, authentication]
cis_id: "5.4.2.7"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.2.7 Ensure system accounts do not have a valid login shell (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

There are a number of accounts provided with most distributions that are used to manage applications and are not intended to provide an interactive shell. Furthermore, a user may add special accounts that are not intended to provide an interactive shell.

## Rationale

It is important to make sure that accounts that are not being used by regular users are prevented from being used to provide an interactive shell. By default, most distributions set the password field for these accounts to an invalid string, but it is also recommended that the shell field in the password file be set to the `nologin` shell. This prevents the account from potentially being used to run any commands.

## Audit Procedure

### Command Line

Run the following command to verify system accounts, except for `root`, `halt`, `sync`, `shutdown` or `nfsnobody`, do not have a valid login shell:

```bash
#!/usr/bin/env bash

{
  l_valid_shells="^($(awk -F\/ '$NF != "nologin" {print}' /etc/shells | sed -rn '/^\//!d;s,/,\\\\/,g;p' | paste -s -d '|' - ))$"
  awk -v pat="$l_valid_shells" -F: '($1!~/^(root|halt|sync|shutdown|nfsnobody)$/ && ($3<'"$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)"' || $3 == 65534) && $(NF) ~ pat) {print "Service account: \"" $1 "\" has a valid shell: " $7}' /etc/passwd
}
```

## Expected Result

Nothing should be returned

## Remediation

### Command Line

Run the following command to set the shell for any service accounts returned by the audit to `nologin`:

```bash
# usermod -s $(command -v nologin) <user>
```

Example script:

```bash
#!/usr/bin/env bash

{
  l_valid_shells="^($(awk -F\/ '$NF != "nologin" {print}' /etc/shells | sed -rn '/^\//!d;s,/,\\\\/,g;p' | paste -s -d '|' - ))$"
  awk -v pat="$l_valid_shells" -F: '($1!~/^(root|halt|sync|shutdown|nfsnobody)$/ && ($3<'"$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)"' || $3 == 65534) && $(NF) ~ pat) {system ("usermod -s '"$(command -v nologin)"' " $1)}' /etc/passwd
}
```

## Default Value

None specified.

## References

1. NIST SP 800-53 Rev. 5: AC-2(5), AC-3, AC-11, MP-2

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists: Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. (IG 1, IG 2, IG 3)

v7 - 14.6 Protect Information through Access Control Lists: Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. (IG 1, IG 2, IG 3)

Additional Information: The `root`, `sync`, `shutdown`, and `halt` users are exempted from requiring a non-login shell.

MITRE ATT&CK Mappings: T1078, T1078.001, T1078.003 - Tactics: TA0005 - Mitigations: M1026
