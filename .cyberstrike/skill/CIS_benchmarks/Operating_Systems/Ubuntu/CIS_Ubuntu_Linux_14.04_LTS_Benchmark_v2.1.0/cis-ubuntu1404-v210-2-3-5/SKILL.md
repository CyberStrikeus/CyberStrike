---
name: "CIS Ubuntu 14.04 LTS - 2.3.5 Ensure LDAP client is not installed"
description: "Verify that the LDAP client (ldap-utils) package is not installed"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - service-clients
cis_id: "2.3.5"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 2.3.5 Ensure LDAP client is not installed (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The Lightweight Directory Access Protocol (LDAP) was introduced as a replacement for NIS/YP. It is a service that provides a method for looking up information from a central database.

## Rationale

If the system will not need to act as an LDAP client, it is recommended that the software be removed to reduce the potential attack surface.

## Audit Procedure

Run the following command and verify `ldap-utils` is not installed:

```bash
dpkg -s ldap-utils
```

## Expected Result

The command should indicate that the package is not installed (e.g., `dpkg-query: package 'ldap-utils' is not installed`).

## Remediation

Uninstall `ldap-utils` using the appropriate package manager or manual installation:

```bash
apt-get remove ldap-utils
```

## Default Value

ldap-utils is not installed by default.

## Impact

Removing the LDAP client will prevent or inhibit using LDAP for authentication in your environment.

## References

- CIS Controls: 2 Inventory of Authorized and Unauthorized Software

## Profile

- Level 1 - Server
- Level 1 - Workstation
