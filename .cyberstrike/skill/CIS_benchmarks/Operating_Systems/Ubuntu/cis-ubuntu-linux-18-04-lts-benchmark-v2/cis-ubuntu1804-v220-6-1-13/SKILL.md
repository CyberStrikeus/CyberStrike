---
name: cis-ubuntu1804-v220-6-1-13
description: "Ensure permissions on /etc/shells are configured"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, file-permissions]
cis_id: "6.1.13"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.1.13 Ensure permissions on /etc/shells are configured (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

`/etc/shells` is a text file which contains the full pathnames of valid login shells. This file is consulted by `chsh` and available to be queried by other programs.

## Rationale

It is critical to ensure that the `/etc/shells` file is protected from unauthorized access. Although it is protected by default, the file permissions could be changed either inadvertently or through malicious actions.

## Audit Procedure

### Command Line

Run the following command to verify `/etc/shells` is mode 644 or more restrictive, `Uid` is `0/root` and `Gid` is `0/root`:

```bash
# stat -Lc 'Access: (%#a/%A) Uid: ( %u/ %U) Gid: ( %g/ %G)' /etc/shells
```

## Expected Result

```
Access: (0644/-rw-r--r--) Uid: ( 0/ root) Gid: ( 0/ root)
```

## Remediation

### Command Line

Run the following commands to remove excess permissions, set owner, and set group on `/etc/shells`:

```bash
# chmod u-x,go-wx /etc/shells
# chown root:root /etc/shells
```

## Default Value

Access: (0644/-rw-r--r--) Uid: ( 0/ root) Gid: ( 0/ root)

## References

1. NIST SP 800-53 Rev. 5: AC-3, MP-2

## CIS Controls

- v8: **3.3** Configure Data Access Control Lists
- v7: **14.6** Protect Information through Access Control Lists
