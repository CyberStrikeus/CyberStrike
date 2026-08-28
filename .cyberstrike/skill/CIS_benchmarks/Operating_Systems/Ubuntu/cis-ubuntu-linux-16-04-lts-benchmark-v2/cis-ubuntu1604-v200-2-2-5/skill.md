---
name: cis-ubuntu1604-v200-2-2-5
description: "Ensure LDAP client is not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.2.5"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2.5 Ensure LDAP client is not installed (Automated)

## Description

The Lightweight Directory Access Protocol (LDAP) was introduced as a replacement for NIS/YP. It is a service that provides a method for looking up information from a central database.

## Rationale

If the system will not need to act as an LDAP client, it is recommended that the software be removed to reduce the potential attack surface.

## Impact

Removing the LDAP client will prevent or inhibit using LDAP for authentication in your environment.

## Audit Procedure

### Command Line

Verify that ldap-utils is not installed. Use the following command to provide the needed information:

```bash
dpkg -s ldap-utils | grep -E '(Status:|not installed)'
```

## Expected Result

```
dpkg-query: package 'ldap-utils' is not installed and no information is available
```

## Remediation

### Command Line

Uninstall ldap-utils:

```bash
apt purge ldap-utils
```

## Default Value

ldap-utils is not installed on minimal server installations.

## References

1. CIS Controls v7 - 2.6 Address unapproved software

## Profile

- Level 1 - Server
- Level 1 - Workstation
