---
name: "CIS Ubuntu 14.04 LTS - 1.4.3 Ensure authentication required for single user mode"
description: "Verify that authentication is required when booting into single user mode"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - boot
cis_id: "1.4.3"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 1.4.3 Ensure authentication required for single user mode (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Single user mode is used for recovery when the system detects an issue during boot or by manual selection from the bootloader.

## Rationale

Requiring authentication in single user mode prevents an unauthorized user from rebooting the system into single user to gain root privileges without credentials.

## Audit Procedure

Perform the following to determine if a password is set for the root user:

```bash
grep ^root:[*\!]: /etc/shadow
```

No results should be returned.

## Expected Result

No output should be returned. If output is returned, the root account does not have a password set.

## Remediation

Run the following command and follow the prompts to set a password for the root user:

```bash
passwd root
```

## Default Value

Not applicable.

## References

- CIS Controls: 5.1 Minimize And Sparingly Use Administrative Privileges

## Profile

- Level 1 - Server
- Level 1 - Workstation
