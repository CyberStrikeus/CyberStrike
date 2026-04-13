---
name: cis-gcp-cos-5.3.2
description: "Ensure system accounts are secured"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, shadow, user-accounts, shell-timeout]
cis_id: "5.3.2"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.2 Ensure system accounts are secured (Automated)

## Description

There are a number of accounts provided with most distributions that are used to manage applications and are not intended to provide an interactive shell.

## Rationale

It is important to make sure that accounts that are not being used by regular users are prevented from being used to provide an interactive shell. By default, most distributions set the password field for these accounts to an invalid string, but it is also recommended that the shell field in the password file be set to the `nologin` shell. This prevents the account from potentially being used to run any commands.

## Audit Procedure

Run the following commands and verify no results are returned:

```bash
awk -F: '($1!="root" && $1!="sync" && $1!="shutdown" && $1!="halt" && $1!~/^\+/ && $3>='"$(awk '/^\s*SYS_UID_MIN/{print $2}' /etc/login.defs)"' && $3<='"$(awk '/^\s*SYS_UID_MAX/{print $2}' /etc/login.defs)"' && $7!="'"$(which nologin)"'" && $7!="/bin/false") {print}' /etc/passwd
awk -F: '($1!="root" && $1!~/^\+/ && $3>='"$(awk '/^\s*SYS_UID_MIN/{print $2}' /etc/login.defs)"' && $3<='"$(awk '/^\s*SYS_UID_MAX/{print $2}' /etc/login.defs)"') {print $1}' /etc/passwd | xargs -I '{}' passwd -S '{}' | awk '($2!="L" && $2!="LK") {print $1}'
```

## Expected Result

No output should be returned. All system accounts should have `nologin` or `/bin/false` as their shell and should be locked.

## Remediation

Run the commands appropriate for your distribution:

Set the shell for any accounts returned by the audit to nologin:

```bash
# usermod -s $(which nologin) <user>
```

Lock any non root accounts returned by the audit:

```bash
# usermod -L <user>
```

The following command will set all system accounts to a non login shell:

```bash
awk -F: '($1!="root" && $1!="sync" && $1!="shutdown" && $1!="halt" && $1!~/^\+/ && $3>='"$(awk '/^\s*SYS_UID_MIN/{print $2}' /etc/login.defs)"' && $3<='"$(awk '/^\s*SYS_UID_MAX/{print $2}' /etc/login.defs)"' && $7!="'"$(which nologin)"'" && $7!="/bin/false") {print $1}' /etc/passwd | while read user; do usermod -s $(which nologin) $user; done
```

The following command will automatically lock not root system accounts:

```bash
awk -F: '($1!="root" && $1!~/^\+/ && $3>='"$(awk '/^\s*SYS_UID_MIN/{print $2}' /etc/login.defs)"' && $3<='"$(awk '/^\s*SYS_UID_MAX/{print $2}' /etc/login.defs)"') {print $1}' /etc/passwd | xargs -I '{}' passwd -S '{}' | awk '($2!="L" && $2!="LK") {print $1}' | while read user; do usermod -L $user; done
```

Additional Information:

The `root`, `sync`, `shutdown`, and `halt` users are exempted from requiring a non-login shell.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | **6.1 Establish an Access Granting Process** - Establish and follow a process, preferably automated, for granting access to enterprise assets upon new hire, rights grant, or role change of a user. | x | x | x |

## Profile

- Level 2 - Server
