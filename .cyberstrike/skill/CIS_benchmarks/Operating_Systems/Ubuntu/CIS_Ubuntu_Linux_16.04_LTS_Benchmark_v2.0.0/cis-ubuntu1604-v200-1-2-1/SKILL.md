---
name: cis-ubuntu1604-v200-1-2-1
description: "Ensure package manager repositories are configured"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, package-manager, repositories, patch-management]
cis_id: "1.2.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.2.1

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Systems need to have package manager repositories configured to ensure they receive the latest patches and updates.

## Rationale

If a system's package repositories are misconfigured important patches may not be identified or a rogue repository could introduce compromised software.

## Audit Procedure

### Command Line

Run the following command and verify package repositories are configured correctly:

```bash
apt-cache policy
```

## Expected Result

Verify that package repositories are configured correctly per site policy.

## Remediation

### Command Line

Configure your package manager repositories according to site policy.

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
