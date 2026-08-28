---
name: cis-ubuntu1204-v110-2-9
description: "Create Separate Partition for /home"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, filesystem, partitioning, home]
cis_id: "2.9"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.9 Create Separate Partition for /home (Scored)

## Profile Applicability

- Level 1

## Description

The `/home` directory is used to support disk storage needs of local users.

## Rationale

If the system is intended to support local users, create a separate partition for the `/home` directory to protect against resource exhaustion and restrict the type of files that can be stored under `/home`.

## Audit Procedure

### Using Command Line

```bash
grep "[[:space:]]/home[[:space:]]" /etc/fstab
```

## Expected Result

A partition entry for `/home` should be returned. If the command emits no output then the system is not configured as recommended.

## Remediation

### Using Command Line

For new installations, during installation create a custom partition setup and specify a separate partition for `/home`.

For systems that were previously installed, use the Logical Volume Manager (LVM) to create partitions.

## Default Value

By default, Ubuntu does not create a separate partition for `/home`.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0
- AJ Lewis, "LVM HOWTO", http://tldp.org/HOWTO/LVM-HOWTO/

## Profile

Level 1 - Scored
