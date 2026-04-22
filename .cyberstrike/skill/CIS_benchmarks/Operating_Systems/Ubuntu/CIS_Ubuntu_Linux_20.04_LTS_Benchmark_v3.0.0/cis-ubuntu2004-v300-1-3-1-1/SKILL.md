---
name: cis-ubuntu2004-v300-1-3-1-1
description: "Ensure latest versions of the apparmor packages are installed"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, apparmor, mandatory-access-control]
cis_id: "1.3.1.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.3.1.1 Ensure latest versions of the apparmor packages are installed (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

AppArmor provides Mandatory Access Controls.

## Rationale

Without a Mandatory Access Control system installed only the default Discretionary Access Control system will be available.

## Audit Procedure

### Command Line

Run the following command to verify that `apparmor` is installed:

```bash
# dpkg-query -s apparmor &>/dev/null && echo "apparmor is installed"
```

Run the following command to verify that `apparmor-utils` is installed:

```bash
# dpkg-query -s apparmor-utils &>/dev/null && echo "apparmor-utils is installed"
```

Run the following command to verify `apparmor` is the latest version:

```bash
# apt list --upgradable 2>&1 | grep -P '^apparmor\b'
```

Run the following command to verify `apparmor-utils` is the latest version:

```bash
# apt list --upgradable 2>&1 | grep -P '^apparmor-utils\b'
```

## Expected Result

- `apparmor is installed` should be returned
- `apparmor-utils is installed` should be returned
- Nothing should be returned for the upgradable checks (packages are up to date)

## Remediation

### Command Line

Run the following command to install the latest versions of `apparmor` and `apparmor-utils`:

```bash
# apt install apparmor apparmor-utils
```

## References

1. NIST SP 800-53 Rev. 5: AC-3

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | * | * | * |
| v7 | 14.6 Protect Information through Access Control Lists | * | * | * |

MITRE ATT&CK Mappings: T1068, T1068.000, T1565, T1565.001, T1565.003 | TA0003 | M1026
