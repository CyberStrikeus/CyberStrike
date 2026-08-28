---
name: cis-ubuntu1604-v200-1-1-15
description: "Ensure separate partition exists for /var/log"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, filesystem, var-log, partition, logging]
cis_id: "1.1.15"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure separate partition exists for /var/log

## Description

The /var/log directory is used by system services to store log data.

## Rationale

There are two important reasons to ensure that system logs are stored on a separate partition: protection against resource exhaustion (since logs can grow quite large) and protection of audit data.

## Impact

Resizing filesystems is a common activity in cloud-hosted servers. Separate filesystem partitions may prevent successful resizing, or may require the installation of additional tools solely for the purpose of resizing operations. The use of these additional tools may introduce their own security considerations.

## Audit Procedure

### Command Line

```bash
# Run the following command and verify output shows /var/log is mounted:
findmnt /var/log
```

## Expected Result

```
TARGET    SOURCE    FSTYPE   OPTIONS
/var/log  <device>  <fstype> rw,relatime,attr2,inode64,noquota
```

## Remediation

### Command Line

```bash
# For new installations, during installation create a custom partition setup and specify a separate partition for /var/log.
# For systems that were previously installed, create a new partition and configure /etc/fstab as appropriate.
```

## Default Value

By default /var/log is not configured as a separate partition.

## References

- AJ Lewis, "LVM HOWTO", http://tldp.org/HOWTO/LVM-HOWTO/
- CIS Controls Version 7 - 6.4 Ensure adequate storage for logs: Ensure that all systems that store logs have adequate storage space for the logs generated.

## Profile

Level 2 - Server / Level 2 - Workstation, Assessment: Automated
