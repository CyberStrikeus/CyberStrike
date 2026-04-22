---
name: cis-ubuntu1604-v200-1-1-10
description: "Ensure separate partition exists for /var"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, filesystem, var, partition]
cis_id: "1.1.10"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure separate partition exists for /var

## Description

The /var directory is used by daemons and other system services to temporarily store dynamic data. Some directories created by these processes may be world-writable.

## Rationale

Since the /var directory may contain world-writable files and directories, there is a risk of resource exhaustion if it is not bound to a separate partition.

## Impact

Resizing filesystems is a common activity in cloud-hosted servers. Separate filesystem partitions may prevent successful resizing, or may require the installation of additional tools solely for the purpose of resizing operations. The use of these additional tools may introduce their own security considerations.

## Audit Procedure

### Command Line

```bash
# Run the following command and verify output shows /var is mounted:
findmnt /var
```

## Expected Result

```
TARGET SOURCE    FSTYPE  OPTIONS
/var   <device>  <fstype> rw,relatime,attr2,inode64,noquota
```

## Remediation

### Command Line

```bash
# For new installations, during installation create a custom partition setup and specify a separate partition for /var.
# For systems that were previously installed, create a new partition and configure /etc/fstab as appropriate.
```

## Default Value

By default /var is not configured as a separate partition.

## References

- AJ Lewis, "LVM HOWTO", http://tldp.org/HOWTO/LVM-HOWTO/
- CIS Controls Version 7 - 5.1 Establish Secure Configurations: Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile

Level 2 - Server / Level 2 - Workstation, Assessment: Automated
