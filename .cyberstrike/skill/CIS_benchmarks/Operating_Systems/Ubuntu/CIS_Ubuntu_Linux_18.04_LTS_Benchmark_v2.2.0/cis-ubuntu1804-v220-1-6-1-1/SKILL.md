---
name: cis-ubuntu1804-v220-1-6-1-1
description: "Ensure AppArmor is installed"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, apparmor, mac, mandatory-access-control]
cis_id: "1.6.1.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.6.1.1 Ensure AppArmor is installed (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

AppArmor provides Mandatory Access Controls.

## Rationale

Without a Mandatory Access Control system installed only the default Discretionary Access Control system will be available.

## Audit Procedure

### Command Line

Run the follow command to verify that `apparmor` is installed:

```bash
dpkg-query -s apparmor &>/dev/null && echo "apparmor is installed"
```

Run the follow command to verify that `apparmor-utils` is installed:

```bash
dpkg-query -s apparmor-utils &>/dev/null && echo "apparmor-utils is installed"
```

## Expected Result

```
apparmor is installed
apparmor-utils is installed
```

## Remediation

### Command Line

Install `apparmor`:

```bash
apt install apparmor apparmor-utils
```

## References

1. NIST SP 800-53 Rev. 5: AC-3

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | X | X | X |
| v7 | 14.6 Protect Information through Access Control Lists | X | X | X |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1068, T1068.000, T1565, T1565.001, T1565.003 | TA0003 | M1026 |
