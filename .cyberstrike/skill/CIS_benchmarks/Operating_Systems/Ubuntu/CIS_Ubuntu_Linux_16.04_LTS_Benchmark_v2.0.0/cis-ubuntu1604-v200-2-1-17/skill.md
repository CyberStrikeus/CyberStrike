---
name: cis-ubuntu1604-v200-2-1-17
description: "Ensure NIS Server is not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.1.17"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.17 Ensure NIS Server is not installed (Automated)

## Description

The Network Information Service (NIS) (formally known as Yellow Pages) is a client-server directory service protocol for distributing system configuration files. The NIS server is a collection of programs that allow for the distribution of configuration files.

## Rationale

The NIS service is inherently an insecure system that has been vulnerable to DOS attacks, buffer overflows and has poor authentication for querying NIS maps. NIS generally has been replaced by such protocols as Lightweight Directory Access Protocol (LDAP). It is recommended that the service be removed and other, more secure services be used.

## Audit Procedure

### Command Line

Run the following command to verify nis is not installed:

```bash
dpkg -s nis | grep -E '(Status:|not installed)'
```

## Expected Result

```
dpkg-query: package 'nis' is not installed and no information is available
```

## Remediation

### Command Line

Run the following command to remove nis:

```bash
apt purge nis
```

## Default Value

nis is not installed on minimal server installations.

## References

1. CIS Controls v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile

- Level 1 - Server
- Level 1 - Workstation
