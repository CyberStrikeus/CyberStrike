---
name: "CIS Ubuntu 14.04 LTS - 6.2.2 Ensure no legacy + entries exist in /etc/passwd"
description: "Verify no legacy NIS '+' entries exist in /etc/passwd"
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
cis_id: "6.2.2"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 6.2.2 Ensure no legacy "+" entries exist in /etc/passwd (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The character `+` in various files used to be markers for systems to insert data from NIS maps at a certain point in a system configuration file. These entries are no longer required on most systems, but may exist in files that have been imported from other platforms.

## Rationale

These entries may provide an avenue for attackers to gain privileged access on the system.

## Audit Procedure

Run the following command and verify that no output is returned:

```bash
grep '^\+:' /etc/passwd
```

## Expected Result

No output should be returned.

## Remediation

Remove any legacy '+' entries from `/etc/passwd` if they exist.

## Default Value

Not applicable.

## References

None

## CIS Controls

16.9 Configure Account Access Centrally - Configure access for all accounts through a centralized point of authentication, for example Active Directory or LDAP. Configure network and security devices for centralized authentication as well.

## Profile

- Level 1
