---
name: "CIS Ubuntu 14.04 LTS - 5.4.4 Ensure default user umask is 027 or more restrictive"
description: "Verify default umask is set to 027 or more restrictive in shell configuration files"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - user-accounts
cis_id: "5.4.4"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 5.4.4 Ensure default user umask is 027 or more restrictive (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The default `umask` determines the permissions of files created by users. The user creating the file has the discretion of making their files and directories readable by others via the chmod command. Users who wish to allow their files and directories to be readable by others by default may choose a different default umask by inserting the `umask` command into the standard shell configuration files (`.profile`, `.bashrc`, etc.) in their home directories.

## Rationale

Setting a very secure default value for `umask` ensures that users make a conscious choice about their file permissions. A default `umask` setting of `077` causes files and directories created by users to not be readable by any other user on the system. A `umask` of `027` would make files and directories readable by users in the same Unix group, while a `umask` of `022` would make files readable by every user on the system.

## Audit Procedure

Run the following commands and verify all umask lines returned are 027 or more restrictive:

```bash
grep "umask" /etc/bash.bashrc
grep "umask" /etc/profile /etc/profile.d/*.sh
```

## Expected Result

```
umask 027
```

## Remediation

Edit the `/etc/bash.bashrc`, `/etc/profile` and `/etc/profile.d/*.sh` files (and the appropriate files for any other shell supported on your system) and add or edit any umask parameters as follows:

```
umask 027
```

## Default Value

umask 022

## References

- CIS Controls: 13 - Data Protection

## Profile

- Level 1 - Server
- Level 1 - Workstation
