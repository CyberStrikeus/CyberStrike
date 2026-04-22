---
name: cis-ubuntu1604-v200-1-1-17
description: "Ensure separate partition exists for /home"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, filesystem, home, partition]
cis_id: "1.1.17"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure separate partition exists for /home

## Description

The /home directory is used to support disk storage needs of local users.

## Rationale

If the system is intended to support local users, create a separate partition for the /home directory to protect against resource exhaustion and restrict the type of files that can be stored under /home.

## Impact

Resizing filesystems is a common activity in cloud-hosted servers. Separate filesystem partitions may prevent successful resizing, or may require the installation of additional tools solely for the purpose of resizing operations. The use of these additional tools may introduce their own security considerations.

## Audit Procedure

### Command Line

```bash
# Run the following command and verify output shows /home is mounted:
findmnt /home
```

## Expected Result

```
TARGET  SOURCE    FSTYPE   OPTIONS
/home   <device>  <fstype> rw,relatime,attr2,inode64,noquota
```

## Remediation

### Command Line

```bash
# For new installations, during installation create a custom partition setup and specify a separate partition for /home.
# For systems that were previously installed, create a new partition and configure /etc/fstab as appropriate.
```

## Default Value

By default /home is not configured as a separate partition.

## References

- AJ Lewis, "LVM HOWTO", http://tldp.org/HOWTO/LVM-HOWTO/
- CIS Controls Version 7 - 5.1 Establish Secure Configurations: Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile

Level 2 - Server / Level 2 - Workstation, Assessment: Automated
