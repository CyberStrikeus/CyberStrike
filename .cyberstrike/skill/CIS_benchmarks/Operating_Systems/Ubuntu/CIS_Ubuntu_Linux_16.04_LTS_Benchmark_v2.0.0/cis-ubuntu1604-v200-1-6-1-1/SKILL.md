---
name: cis-ubuntu1604-v200-1-6-1-1
description: "Ensure AppArmor is installed"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, apparmor, mac, mandatory-access-control]
cis_id: "1.6.1.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.6.1.1

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

AppArmor provides Mandatory Access Controls.

## Rationale

Without a Mandatory Access Control system installed only the default Discretionary Access Control system will be available.

## Audit Procedure

### Command Line

Verify that AppArmor is installed:

```bash
dpkg -s apparmor | grep -E '(Status:|not installed)'
```

Expected output: `Status: install ok installed`

## Expected Result

The `apparmor` package should show `Status: install ok installed`.

## Remediation

### Command Line

Install AppArmor:

```bash
apt install apparmor
```

## Default Value

AppArmor is installed by default on Ubuntu.

## References

None.

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 14.6 Protect Information through Access Control Lists |

## Assessment Status

Automated
