---
name: "CIS Ubuntu 14.04 LTS - 1.2.1 Ensure package manager repositories are configured"
description: "Verify that package manager repositories are properly configured to receive latest patches and updates"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - not-scored
  - software-updates
cis_id: "1.2.1"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 1.2.1 Ensure package manager repositories are configured (Not Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Systems need to have package manager repositories configured to ensure they receive the latest patches and updates.

## Rationale

If a system's package repositories are misconfigured important patches may not be identified or a rogue repository could introduce compromised software.

## Audit Procedure

Run the following command and verify package repositories are configured correctly:

```bash
apt-cache policy
```

## Expected Result

Verify that repositories are configured according to site policy.

## Remediation

Configure your package manager repositories according to site policy.

## Default Value

Not applicable. Configuration varies by site policy.

## References

- CIS Controls: 4.5 Use Automated Patch Management And Software Update Tools

## Profile

- Level 1 - Server
- Level 1 - Workstation
