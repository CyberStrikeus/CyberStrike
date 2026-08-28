---
name: "CIS Ubuntu 14.04 LTS - 1.2.2 Ensure GPG keys are configured"
description: "Verify that GPG keys are configured for package manager to ensure package integrity"
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
cis_id: "1.2.2"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 1.2.2 Ensure GPG keys are configured (Not Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Most packages managers implement GPG key signing to verify package integrity during installation.

## Rationale

It is important to ensure that updates are obtained from a valid source to protect against spoofing that could lead to the inadvertent installation of malware on the system.

## Audit Procedure

Run the following command and verify GPG keys are configured correctly for your package manager:

```bash
apt-key list
```

## Expected Result

Verify that GPG keys are configured according to site policy.

## Remediation

Update your package manager GPG keys in accordance with site policy.

## Default Value

Not applicable. Configuration varies by site policy.

## References

- CIS Controls: 4.5 Use Automated Patch Management And Software Update Tools

## Profile

- Level 1 - Server
- Level 1 - Workstation
