---
name: cis-ubuntu1804-v220-1-3-3
description: "Ensure GPG keys are configured"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, gpg, package-integrity, apt]
cis_id: "1.3.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.3.3 Ensure GPG keys are configured (Manual)

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

GPG keys should be properly configured according to site policy.

## Remediation

### Command Line

Update your package manager GPG keys in accordance with site policy.

## References

1. NIST SP 800-53 Rev. 5: SI-2

## CIS Controls

| Controls Version | Control                                                      | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 7.3 Perform Automated Operating System Patch Management      | X    | X    | X    |
| v7               | 3.4 Deploy Automated Operating System Patch Management Tools | X    | X    | X    |
| v7               | 3.5 Deploy Automated Software Patch Management Tools         | X    | X    | X    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1195, T1195.001, T1195.002 | TA0001  | M1051       |
