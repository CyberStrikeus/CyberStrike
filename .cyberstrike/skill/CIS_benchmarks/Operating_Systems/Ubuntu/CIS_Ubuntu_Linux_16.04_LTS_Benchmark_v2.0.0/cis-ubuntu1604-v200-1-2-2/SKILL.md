---
name: cis-ubuntu1604-v200-1-2-2
description: "Ensure GPG keys are configured"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, gpg, package-integrity, patch-management]
cis_id: "1.2.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.2.2

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Most packages managers implement GPG key signing to verify package integrity during installation.

## Rationale

It is important to ensure that updates are obtained from a valid source to protect against spoofing that could lead to the inadvertent installation of malware on the system.

## Audit Procedure

### Command Line

Verify GPG keys are configured correctly for your package manager:

```bash
apt-key list
```

## Expected Result

Verify GPG keys are configured correctly for your package manager.

## Remediation

### Command Line

Update your package manager GPG keys in accordance with site policy.

## Default Value

Not applicable.

## References

None.

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 3.4 Deploy Automated Operating System Patch Management Tools |
| v7 | 3.5 Deploy Automated Software Patch Management Tools |

## Assessment Status

Manual
