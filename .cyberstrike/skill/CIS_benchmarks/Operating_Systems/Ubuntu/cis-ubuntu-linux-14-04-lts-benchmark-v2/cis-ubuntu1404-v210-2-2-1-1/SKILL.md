---
name: "CIS Ubuntu 14.04 LTS - 2.2.1.1 Ensure time synchronization is in use"
description: "Verify that NTP or chrony is installed for system time synchronization"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - not-scored
  - services
cis_id: "2.2.1.1"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 2.2.1.1 Ensure time synchronization is in use (Not Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

System time should be synchronized between all systems in an environment. This is typically done by establishing an authoritative time server or set of servers and having all systems synchronize their clocks to them.

## Rationale

Time synchronization is important to support time sensitive security mechanisms like Kerberos and also ensures log files have consistent time records across the enterprise, which aids in forensic investigations.

## Audit Procedure

On physical systems or virtual systems where host based time synchronization is not available run the following commands and verify either NTP or chrony is installed:

```bash
dpkg -s ntp
dpkg -s chrony
```

On virtual systems where host based time synchronization is available consult your virtualization software documentation and verify that host based synchronization is in use.

## Expected Result

One of the two packages (`ntp` or `chrony`) should be installed.

## Remediation

On physical systems or virtual systems where host based time synchronization is not available install NTP or chrony using one of the following commands:

```bash
apt-get install ntp
apt-get install chrony
```

On virtual systems where host based time synchronization is available consult your virtualization software documentation and setup host based synchronization.

## Default Value

Time synchronization is not installed by default.

## References

- CIS Controls: 6.1 Use At Least Two Synchronized Time Sources For All Servers And Network Equipment

## Profile

- Level 1 - Server
- Level 1 - Workstation
