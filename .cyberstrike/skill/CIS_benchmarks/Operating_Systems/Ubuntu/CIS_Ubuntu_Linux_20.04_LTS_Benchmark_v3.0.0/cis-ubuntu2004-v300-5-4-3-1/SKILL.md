---
name: cis-ubuntu2004-v300-5-4-3-1
description: "Ensure nologin is not listed in /etc/shells"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, users, authentication]
cis_id: "5.4.3.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.4.3.1 Ensure nologin is not listed in /etc/shells (Automated)

## Profile

- Level 2 - Server
- Level 2 - Workstation

## Description

`/etc/shells` is a text file which contains the full pathnames of valid login shells. This file is consulted by `chsh` and available to be queried by other programs.

Be aware that there are programs which consult this file to find out if a user is a normal user; for example, FTP daemons traditionally disallow access to users with shells not included in this file.

## Rationale

A user can use `chsh` to change their configured shell.

If a user has a shell configured that isn't in in `/etc/shells`, then the system assumes that they're somehow restricted. In the case of `chsh` it means that the user cannot change that value.

Other programs might query that list and apply similar restrictions.

By putting `nologin` in `/etc/shells`, any user that has `nologin` as its shell is considered a full, unrestricted user. This is not the expected behavior for `nologin`.

## Audit Procedure

### Command Line

Run the following command to verify that `nologin` is not listed in the `/etc/shells` file:

```bash
# grep -Ps '^\h*([^#\n\r]+)?\/nologin\b' /etc/shells
```

## Expected Result

Nothing should be returned

## Remediation

### Command Line

Edit `/etc/shells` and remove any lines that include `nologin`

## Default Value

None specified.

## References

1. shells(5)
2. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## CIS Controls

v8 - 0.0 Explicitly Not Mapped (IG 0)

v7 - 0.0 Explicitly Not Mapped (IG 0)
