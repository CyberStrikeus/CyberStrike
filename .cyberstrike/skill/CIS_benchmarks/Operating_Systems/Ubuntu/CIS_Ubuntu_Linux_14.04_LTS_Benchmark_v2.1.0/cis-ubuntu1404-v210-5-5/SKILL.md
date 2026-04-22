---
name: "CIS Ubuntu 14.04 LTS - 5.5 Ensure root login is restricted to system console"
description: "Verify root login is restricted to physically secure system consoles via /etc/securetty"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - not-scored
  - user-accounts
cis_id: "5.5"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 5.5 Ensure root login is restricted to system console (Not Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The file `/etc/securetty` contains a list of valid terminals that may be logged in directly as root.

## Rationale

Since the system console has special properties to handle emergency situations, it is important to ensure that the console is in a physically secure location and that unauthorized consoles have not been defined.

## Audit Procedure

```bash
cat /etc/securetty
```

## Expected Result

Review the output and verify only physically secure consoles are listed.

## Remediation

Remove entries for any consoles that are not in a physically secure location.

## Default Value

Varies by installation.

## References

- CIS Controls: 5.1 - Minimize And Sparingly Use Administrative Privileges

## Profile

- Level 1 - Server
- Level 1 - Workstation
