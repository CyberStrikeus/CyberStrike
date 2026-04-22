---
name: cis-ubuntu2004-v300-1-2-1-2
description: "Ensure package manager repositories are configured"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, package-management, repositories]
cis_id: "1.2.1.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.1.2 Ensure package manager repositories are configured (Manual)

## Profile

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
# apt-cache policy
```

## Expected Result

Package repositories should be configured according to site policy.

## Remediation

### Command Line

Configure your package manager repositories according to site policy.

## References

1. NIST SP 800-53 Rev. 5: SI-2

## CIS Controls

| Controls Version | Control                                                      | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 7.3 Perform Automated Operating System Patch Management      | \*   | \*   | \*   |
| v8               | 7.4 Perform Automated Application Patch Management           | \*   | \*   | \*   |
| v7               | 3.4 Deploy Automated Operating System Patch Management Tools | \*   | \*   | \*   |
| v7               | 3.5 Deploy Automated Software Patch Management Tools         | \*   | \*   | \*   |

MITRE ATT&CK Mappings: T1195, T1195.001 | TA0005 | M1051
