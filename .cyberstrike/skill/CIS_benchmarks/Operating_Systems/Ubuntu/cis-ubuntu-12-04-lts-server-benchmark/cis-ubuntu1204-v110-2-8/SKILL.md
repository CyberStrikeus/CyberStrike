---
name: cis-ubuntu1204-v110-2-8
description: "Create Separate Partition for /var/log/audit"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, filesystem, partitioning, var-log-audit, auditing]
cis_id: "2.8"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.8 Create Separate Partition for /var/log/audit (Scored)

## Profile Applicability

- Level 1

## Description

The auditing daemon, `auditd`, stores log data in the `/var/log/audit` directory.

## Rationale

There are two important reasons to ensure that data gathered by `auditd` is stored on a separate partition: protection against resource exhaustion (since the `audit.log` file can grow quite large) and protection of audit data. The audit daemon calculates how much free space is left and performs actions based on the results. If other processes (such as `syslog`) consume space in the same partition as `auditd`, it may not perform as desired.

## Audit Procedure

### Using Command Line

```bash
grep "[[:space:]]/var/log/audit[[:space:]]" /etc/fstab
```

## Expected Result

A partition entry for `/var/log/audit` should be returned. If the command emits no output then the system is not configured as recommended.

## Remediation

### Using Command Line

For new installations, during installation create a custom partition setup and specify a separate partition for `/var/log/audit`.

For systems that were previously installed, use the Logical Volume Manager (LVM) to create partitions.

## Default Value

By default, Ubuntu does not create a separate partition for `/var/log/audit`.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0
- AJ Lewis, "LVM HOWTO", http://tldp.org/HOWTO/LVM-HOWTO/

## Profile

Level 1 - Scored
