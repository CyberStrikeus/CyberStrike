---
name: "CIS Ubuntu 14.04 LTS - 6.2.5 Ensure root is the only UID 0 account"
description: "Verify that only the root account has UID 0"
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
cis_id: "6.2.5"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 6.2.5 Ensure root is the only UID 0 account (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Any account with UID 0 has superuser privileges on the system.

## Rationale

This access must be limited to only the default `root` account and only from the system console. Administrative access must be through an unprivileged account using an approved mechanism as noted in Item 5.6 Ensure access to the su command is restricted.

## Audit Procedure

Run the following command and verify that only "root" is returned:

```bash
cat /etc/passwd | awk -F: '($3 == 0) { print $1 }'
```

## Expected Result

```
root
```

## Remediation

Remove any users other than `root` with UID `0` or assign them a new UID if appropriate.

## Default Value

Only `root` has UID 0 by default.

## References

None

## CIS Controls

5.1 Minimize And Sparingly Use Administrative Privileges - Minimize administrative privileges and only use administrative accounts when they are required. Implement focused auditing on the use of administrative privileged functions and monitor for anomalous behavior.

## Profile

- Level 1
