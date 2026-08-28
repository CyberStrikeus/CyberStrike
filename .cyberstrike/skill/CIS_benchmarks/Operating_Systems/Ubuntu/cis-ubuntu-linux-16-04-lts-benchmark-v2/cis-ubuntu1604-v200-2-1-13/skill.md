---
name: cis-ubuntu1604-v200-2-1-13
description: "Ensure HTTP Proxy Server is not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.1.13"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.13 Ensure HTTP Proxy Server is not installed (Automated)

## Description

Squid is a standard proxy server used in many distributions and environments.

## Rationale

If there is no need for a proxy server, it is recommended that the squid proxy be deleted to reduce the potential attack surface.

## Audit Procedure

### Command Line

Run the following command to verify squid is not installed:

```bash
dpkg -s squid | grep -E '(Status:|not installed)'
```

## Expected Result

```
dpkg-query: package 'squid' is not installed and no information is available
```

## Remediation

### Command Line

Run the following command to remove squid:

```bash
apt purge squid
```

## Default Value

squid is not installed on minimal server installations. Several HTTP proxy servers exist. These and other services should be checked.

## References

1. CIS Controls v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile

- Level 1 - Server
- Level 1 - Workstation
