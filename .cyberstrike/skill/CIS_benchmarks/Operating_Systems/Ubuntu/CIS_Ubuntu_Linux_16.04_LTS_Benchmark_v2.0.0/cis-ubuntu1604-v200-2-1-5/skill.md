---
name: cis-ubuntu1604-v200-2-1-5
description: "Ensure DHCP Server is not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.1.5"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.5 Ensure DHCP Server is not installed (Automated)

## Description

The Dynamic Host Configuration Protocol (DHCP) is a service that allows machines to be dynamically assigned IP addresses.

## Rationale

Unless a system is specifically set up to act as a DHCP server, it is recommended that this package be removed to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following commands to verify isc-dhcp-server is not installed:

```bash
dpkg -s isc-dhcp-server | grep -E '(Status:|not installed)'
```

## Expected Result

```
dpkg-query: package 'isc-dhcp-server' is not installed and no information is available
```

## Remediation

### Command Line

Run the following command to remove isc-dhcp-server:

```bash
apt purge isc-dhcp-server
```

## Default Value

isc-dhcp-server is not installed on minimal server installations.

## References

1. More detailed documentation on DHCP is available at http://www.isc.org/software/dhcp.
2. CIS Controls v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile

- Level 1 - Server
- Level 1 - Workstation
