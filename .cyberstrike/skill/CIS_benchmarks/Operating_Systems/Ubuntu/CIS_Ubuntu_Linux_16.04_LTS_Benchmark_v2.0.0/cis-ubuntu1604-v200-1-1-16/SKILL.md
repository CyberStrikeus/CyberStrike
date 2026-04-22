---
name: cis-ubuntu1604-v200-1-1-16
description: "Ensure separate partition exists for /var/log/audit"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, filesystem, var-log-audit, partition, audit]
cis_id: "1.1.16"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure separate partition exists for /var/log/audit

## Description

The auditing daemon, auditd, stores log data in the /var/log/audit directory.

## Rationale

There are two important reasons to ensure that data gathered by auditd is stored on a separate partition: protection against resource exhaustion (since the audit.log file can grow quite large) and protection of audit data. The audit daemon calculates how much free space is left and performs actions based on the results. If other processes (such as syslog) consume space in the same partition as auditd, it may not perform as desired.

## Impact

Resizing filesystems is a common activity in cloud-hosted servers. Separate filesystem partitions may prevent successful resizing, or may require the installation of additional tools solely for the purpose of resizing operations. The use of these additional tools may introduce their own security considerations.

## Audit Procedure

### Command Line

```bash
# Run the following command and verify output shows /var/log/audit is mounted:
findmnt /var/log/audit
```

## Expected Result

```
TARGET          SOURCE    FSTYPE   OPTIONS
/var/log/audit  <device>  <fstype> rw,relatime,attr2,inode64,noquota
```

## Remediation

### Command Line

```bash
# For new installations, during installation create a custom partition setup and specify a separate partition for /var/log/audit.
# For systems that were previously installed, create a new partition and configure /etc/fstab as appropriate.
```

## Default Value

By default /var/log/audit is not configured as a separate partition.

## References

- AJ Lewis, "LVM HOWTO", http://tldp.org/HOWTO/LVM-HOWTO/
- CIS Controls Version 7 - 6.4 Ensure adequate storage for logs: Ensure that all systems that store logs have adequate storage space for the logs generated.

## Profile

Level 2 - Server / Level 2 - Workstation, Assessment: Automated
