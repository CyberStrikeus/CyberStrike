---
name: cis-ubuntu1604-v200-2-1-16
description: "Ensure rsync service is not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.1.16"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.16 Ensure rsync service is not installed (Automated)

## Description

The rsync service can be used to synchronize files between systems over network links.

## Rationale

The rsync service presents a security risk as it uses unencrypted protocols for communication. The rsync package should be removed to reduce the attack area of the system.

## Audit Procedure

### Command Line

Run the following command to verify rsync is not installed:

```bash
dpkg -s rsync | grep -E '(Status:|not installed)'
```

## Expected Result

```
dpkg-query: package 'rsync' is not installed and no information is available
```

## Remediation

### Command Line

Run the following command to remove rsync:

```bash
apt purge rsync
```

## Default Value

rsync is not installed on minimal server installations.

## References

1. CIS Controls v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile

- Level 1 - Server
- Level 1 - Workstation
