---
name: cis-ubuntu1204-v110-13-5
description: "Verify No UID 0 Accounts Exist Other Than root"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, user-management, uid, root, privilege-escalation]
cis_id: "13.5"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 13.5 Verify No UID 0 Accounts Exist Other Than root (Scored)

## Profile Applicability

- Level 1

## Description

Any account with UID 0 has superuser privileges on the system.

## Rationale

This access must be limited to only the default `root` account and only from the system console. Administrative access must be through an unprivileged account using an approved mechanism as noted in Item 9.4 Restrict root Login to System Console.

## Audit Procedure

### Using Command Line

Run the following command and verify that only the word "root" is returned:

```bash
/bin/cat /etc/passwd | /usr/bin/awk -F: '($3 == 0) { print $1 }' root
```

## Expected Result

Only `root` should be returned. Any other accounts with UID 0 represent a security risk.

## Remediation

### Using Command Line

Delete any other entries that are displayed besides `root`.

## Default Value

Only the `root` account has UID 0 by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
