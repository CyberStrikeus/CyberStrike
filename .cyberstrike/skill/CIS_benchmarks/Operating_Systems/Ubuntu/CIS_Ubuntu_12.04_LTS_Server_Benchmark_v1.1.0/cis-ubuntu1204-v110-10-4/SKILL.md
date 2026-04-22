---
name: cis-ubuntu1204-v110-10-4
description: "Set Default umask for Users"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, umask, file-permissions, user-environment]
cis_id: "10.4"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.4 Set Default umask for Users (Scored)

## Profile Applicability

- Level 1

## Description

The default `umask` determines the permissions of files created by users. The user creating the file has the discretion of making their files and directories readable by others via the `chmod` command. Users who wish to allow their files and directories to be readable by others by default may choose a different default umask by inserting the `umask` command into the standard shell configuration files (`.profile`, `.bashrc`, etc.) in their home directories.

## Rationale

Setting a very secure default value for `umask` ensures that users make a conscious choice about their file permissions. A default `umask` setting of `077` causes files and directories created by users to not be readable by any other user on the system. A `umask` of `027` would make files and directories readable by users in the same Unix group, while a `umask` of `022` would make files readable by every user on the system.

**Note:** The directives in this section apply to bash and shell. If other shells are supported on the system, it is recommended that their configuration files also are checked.

## Audit Procedure

### Using Command Line

```bash
grep "^UMASK" /etc/login.defs
```

## Expected Result

```
UMASK 077
```

## Remediation

### Using Command Line

Edit the `/etc/login.defs` file (and the appropriate files for any other shell supported on your system as necessary) and set the UMASK parameter as shown:

```bash
# Edit /etc/login.defs and set:
UMASK 077
```

## Default Value

UMASK 022

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
