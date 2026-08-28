---
name: cis-ubuntu1604-v200-2-1-6
description: "Ensure LDAP server is not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.1.6"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.6 Ensure LDAP server is not installed (Automated)

## Description

The Lightweight Directory Access Protocol (LDAP) was introduced as a replacement for NIS/YP. It is a service that provides a method for looking up information from a central database.

## Rationale

If the system will not need to act as an LDAP server, it is recommended that the software be removed to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following command to verify slapd is not installed:

```bash
dpkg -s slapd | grep -E '(Status:|not installed)'
```

## Expected Result

```
dpkg-query: package 'slapd' is not installed and no information is available
```

## Remediation

### Command Line

Run one of the following commands to remove slapd:

```bash
apt purge slapd
```

## Default Value

slapd is not installed on minimal server installations.

## References

1. For more detailed documentation on OpenLDAP, go to the project homepage at http://www.openldap.org.
2. CIS Controls v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile

- Level 1 - Server
- Level 1 - Workstation
