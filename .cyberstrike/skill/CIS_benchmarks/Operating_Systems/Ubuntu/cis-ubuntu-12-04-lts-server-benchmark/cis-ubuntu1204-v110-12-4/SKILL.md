---
name: cis-ubuntu1204-v110-12-4
description: "Verify User/Group Ownership on /etc/passwd"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, file-ownership, passwd, access-control]
cis_id: "12.4"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 12.4 Verify User/Group Ownership on /etc/passwd (Scored)

## Profile Applicability

- Level 1

## Description

The `/etc/passwd` file contains a list of all the valid userIDs defined in the system, but not the passwords. The command below sets the owner and group of the file to root.

## Rationale

The `/etc/passwd` file needs to be protected from unauthorized changes by non-privileged users, but needs to be readable as this information is used with many non-privileged programs.

## Audit Procedure

### Using Command Line

Run the following command to determine the user and group ownership on the `/etc/passwd` file:

```bash
/bin/ls -l /etc/passwd
```

## Expected Result

```
-rw-r--r-- 1 root root <size> <date> /etc/passwd
```

Owner should be `root` and group should be `root`.

## Remediation

### Using Command Line

If the user and group ownership of the `/etc/passwd` file are incorrect, run the following command to correct them:

```bash
/bin/chown root:root /etc/passwd
```

## Default Value

root:root

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
