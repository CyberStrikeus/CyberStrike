---
name: "CIS Ubuntu 14.04 LTS - 2.1.11 Ensure openbsd-inetd is not installed"
description: "Verify that openbsd-inetd package is not installed on the system"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - inetd
cis_id: "2.1.11"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 2.1.11 Ensure openbsd-inetd is not installed (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `inetd` daemon listens for well known services and dispatches the appropriate daemon to properly respond to service requests.

## Rationale

If there are no `inetd` services required, it is recommended that the daemon be removed.

## Audit Procedure

Run the following command and verify `openbsd-inetd` is not installed:

```bash
dpkg -s openbsd-inetd
```

## Expected Result

The command should indicate that the package is not installed (e.g., `dpkg-query: package 'openbsd-inetd' is not installed`).

## Remediation

Run the following command to uninstall `openbsd-inetd`:

```bash
apt-get remove openbsd-inetd
```

## Default Value

openbsd-inetd is not installed by default on Ubuntu 14.04.

## References

- CIS Controls: 9.1 Limit Open Ports, Protocols, and Services

## Profile

- Level 1 - Server
- Level 1 - Workstation
