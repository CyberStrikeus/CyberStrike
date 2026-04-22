---
name: cis-ubuntu1804-v220-1-4-3
description: "Ensure authentication required for single user mode"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, single-user-mode, authentication, root-password]
cis_id: "1.4.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.4.3 Ensure authentication required for single user mode (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Single user mode is used for recovery when the system detects an issue during boot or by manual selection from the bootloader.

## Rationale

Requiring authentication in single user mode prevents an unauthorized user from rebooting the system into single user to gain root privileges without credentials.

## Audit Procedure

### Command Line

Perform the following to determine if a password is set for the `root` user:

```bash
grep -Eq '^root:\$[0-9]' /etc/shadow || echo "root is locked"
```

## Expected Result

No results should be returned.

## Remediation

### Command Line

Run the following command and follow the prompts to set a password for the `root` user:

```bash
passwd root
```

## References

1. NIST SP 800-53 Rev. 5: IA-5

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 5.2 Use Unique Passwords | X | X | X |
| v7 | 4.4 Use Unique Passwords | | X | X |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1548, T1548.000 | TA0005 | M1022 |
