---
name: cis-ubuntu1204-v110-2-5
description: "Create Separate Partition for /var"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, filesystem, partitioning, var]
cis_id: "2.5"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.5 Create Separate Partition for /var (Scored)

## Profile Applicability

- Level 1

## Description

The `/var` directory is used by daemons and other system services to temporarily store dynamic data. Some directories created by these processes may be world-writable.

## Rationale

Since the `/var` directory may contain world-writable files and directories, there is a risk of resource exhaustion if it is not bound to a separate partition.

## Audit Procedure

### Using Command Line

```bash
grep "[[:space:]]/var[[:space:]]" /etc/fstab
```

## Expected Result

A partition entry for `/var` should be returned. If the command emits no output then the system is not configured as recommended.

## Remediation

### Using Command Line

For new installations, during installation create a custom partition setup and specify a separate partition for `/var`.

For systems that were previously installed, use the Logical Volume Manager (LVM) to create partitions.

## Default Value

By default, Ubuntu does not create a separate partition for `/var`.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0
- AJ Lewis, "LVM HOWTO", http://tldp.org/HOWTO/LVM-HOWTO/

## Profile

Level 1 - Scored
