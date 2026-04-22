---
name: cis-ubuntu1204-v110-3-4
description: "Require Authentication for Single-User Mode"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, boot, single-user, authentication, root-password]
cis_id: "3.4"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.4 Require Authentication for Single-User Mode (Scored)

## Profile Applicability
- Level 1

## Description
Setting a password for the `root` user will force authentication in single user mode.

## Rationale
Requiring authentication in single user mode prevents an unauthorized user from rebooting the system into single user to gain root privileges without credentials.

## Audit Procedure
### Using Command Line
Perform the following to determine if a password is set for the `root` user:
```bash
grep ^root:[*\!]: /etc/shadow
```

## Expected Result
No results should be returned. If a result is returned, the root account does not have a password set.

## Remediation
### Using Command Line
Run the following command and follow the prompts to set a password for the `root` user:
```bash
passwd root
```

## Default Value
By default, the root account may or may not have a password set depending on installation choices.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
