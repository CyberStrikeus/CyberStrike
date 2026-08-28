---
name: cis-ubuntu2004-v300-6-3-1-1
description: "Ensure auditd packages are installed"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, auditing, auditd]
cis_id: "6.3.1.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.3.1.1 Ensure auditd packages are installed (Automated)

## Profile

- Level 2 - Server
- Level 2 - Workstation

## Description

auditd is the userspace component to the Linux Auditing System. It's responsible for writing audit records to the disk

## Rationale

The capturing of system events provides system administrators with information to allow them to determine if unauthorized access to their system is occurring.

## Audit Procedure

### Command Line

Run the following command and verify `auditd` is installed:

```bash
# dpkg-query -s auditd &>/dev/null && echo auditd is installed
auditd is installed
```

Run the following command to verify `audispd-plugins` is installed:

```bash
# dpkg-query -s audispd-plugins &>/dev/null && echo audispd-plugins is installed
audispd-plugins is installed
```

## Expected Result

Both `auditd` and `audispd-plugins` should report as installed.

## Remediation

### Command Line

Run the following command to Install `auditd` and `audispd-plugins`:

```bash
# apt install auditd audispd-plugins
```

## References

1. NIST SP 800-53 Rev. 5: AU-2, AU-3, AU-12, SI-5
2. STIG ID: UBTU-20-010182 | RULE ID: SV-238298r958506 | CAT II
3. STIG ID: UBTU-22-653015 | RULE ID: SV-260591r1015023 | CAT II

## CIS Controls

| Controls Version | Control                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs |      | X    | X    |
| v7               | 6.2 Activate audit logging      | X    | X    | X    |

MITRE ATT&CK Mappings: T1562, T1562.001 / TA0005 / M1018
