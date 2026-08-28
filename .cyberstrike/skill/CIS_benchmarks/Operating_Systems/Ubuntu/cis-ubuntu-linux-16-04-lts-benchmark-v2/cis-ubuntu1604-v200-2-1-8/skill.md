---
name: cis-ubuntu1604-v200-2-1-8
description: "Ensure DNS Server is not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.1.8"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.8 Ensure DNS Server is not installed (Automated)

## Description

The Domain Name System (DNS) is a hierarchical naming system that maps names to IP addresses for computers, services and other resources connected to a network.

## Rationale

Unless a system is specifically designated to act as a DNS server, it is recommended that the package be deleted to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following command to verify DNS server is not installed:

```bash
dpkg -s bind9 | grep -E '(Status:|not installed)'
```

## Expected Result

```
dpkg-query: package 'bind9' is not installed and no information is available
```

## Remediation

### Command Line

Run the following commands to disable DNS server:

```bash
apt purge bind9
```

## Default Value

bind9 is not installed on minimal server installations.

## References

1. CIS Controls v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile

- Level 1 - Server
- Level 1 - Workstation
