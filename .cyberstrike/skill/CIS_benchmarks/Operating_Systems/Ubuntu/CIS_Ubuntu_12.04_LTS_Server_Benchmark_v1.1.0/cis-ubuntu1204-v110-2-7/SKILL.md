---
name: cis-ubuntu1204-v110-2-7
description: "Create Separate Partition for /var/log"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, filesystem, partitioning, var-log, logging]
cis_id: "2.7"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.7 Create Separate Partition for /var/log (Scored)

## Profile Applicability
- Level 1

## Description
The `/var/log` directory is used by system services to store log data.

## Rationale
There are two important reasons to ensure that system logs are stored on a separate partition: protection against resource exhaustion (since logs can grow quite large) and protection of audit data.

## Audit Procedure
### Using Command Line
```bash
grep "[[:space:]]/var/log[[:space:]]" /etc/fstab
```

## Expected Result
A partition entry for `/var/log` should be returned. If the command emits no output then the system is not configured as recommended.

## Remediation
### Using Command Line
For new installations, during installation create a custom partition setup and specify a separate partition for `/var/log`.

For systems that were previously installed, use the Logical Volume Manager (LVM) to create partitions.

## Default Value
By default, Ubuntu does not create a separate partition for `/var/log`.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0
- AJ Lewis, "LVM HOWTO", http://tldp.org/HOWTO/LVM-HOWTO/

## Profile
Level 1 - Scored
