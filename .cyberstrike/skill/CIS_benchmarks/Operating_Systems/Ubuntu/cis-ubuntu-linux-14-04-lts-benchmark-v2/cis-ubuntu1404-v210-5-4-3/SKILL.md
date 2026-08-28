---
name: "CIS Ubuntu 14.04 LTS - 5.4.3 Ensure default group for the root account is GID 0"
description: "Verify the root account default group is GID 0 to prevent root-owned files becoming accessible"
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
cis_id: "5.4.3"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 5.4.3 Ensure default group for the root account is GID 0 (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The usermod command can be used to specify which group the root user belongs to. This affects permissions of files that are created by the root user.

## Rationale

Using GID 0 for the `root` account helps prevent `root`-owned files from accidentally becoming accessible to non-privileged users.

## Audit Procedure

Run the following command and verify the result is `0`:

```bash
grep "^root:" /etc/passwd | cut -f4 -d:
```

## Expected Result

```
0
```

## Remediation

Run the following command to set the `root` user default group to GID `0`:

```bash
usermod -g 0 root
```

## Default Value

GID 0

## References

- CIS Controls: 5 - Controlled Use of Administration Privileges

## Profile

- Level 1 - Server
- Level 1 - Workstation
