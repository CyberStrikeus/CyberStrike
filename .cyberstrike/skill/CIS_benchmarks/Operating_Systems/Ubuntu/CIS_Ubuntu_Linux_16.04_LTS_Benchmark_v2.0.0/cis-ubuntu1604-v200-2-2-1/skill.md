---
name: cis-ubuntu1604-v200-2-2-1
description: "Ensure NIS Client is not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.2.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2.1 Ensure NIS Client is not installed (Automated)

## Description

The Network Information Service (NIS), formerly known as Yellow Pages, is a client-server directory service protocol used to distribute system configuration files. The NIS client was used to bind a machine to an NIS server and receive the distributed configuration files.

## Rationale

The NIS service is inherently an insecure system that has been vulnerable to DOS attacks, buffer overflows and has poor authentication for querying NIS maps. NIS generally has been replaced by such protocols as Lightweight Directory Access Protocol (LDAP). It is recommended the service be removed.

## Impact

Many insecure service clients are used as troubleshooting tools and in testing environments. Uninstalling them can inhibit capability to test and troubleshoot. If they are required it is advisable to remove the clients after use to prevent accidental or intentional misuse.

## Audit Procedure

### Command Line

Verify nis is not installed. Use the following command to provide the needed information:

```bash
dpkg -s nis | grep -E '(Status:|not installed)'
```

## Expected Result

```
dpkg-query: package 'nis' is not installed and no information is available
```

## Remediation

### Command Line

Uninstall nis:

```bash
apt purge nis
```

## Default Value

nis is not installed on minimal server installations.

## References

1. CIS Controls v7 - 2.6 Address unapproved software

## Profile

- Level 1 - Server
- Level 1 - Workstation
