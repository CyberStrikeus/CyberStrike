---
name: cis-ubuntu1604-v200-1-1-11
description: "Ensure separate partition exists for /var/tmp"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, filesystem, var-tmp, partition]
cis_id: "1.1.11"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure separate partition exists for /var/tmp

## Description

The /var/tmp directory is a world-writable directory used for temporary storage by all users and some applications.

## Rationale

Since the /var/tmp directory is intended to be world-writable, there is a risk of resource exhaustion if it is not bound to a separate partition. In addition, making /var/tmp its own file system allows an administrator to set the noexec option on the mount, making /var/tmp useless for an attacker to install executable code. It would also prevent an attacker from establishing a hardlink to a system setuid program and wait for it to be updated. Once the program was updated, the hardlink would be broken and the attacker would have his own copy of the program. If the program happened to have a security vulnerability, the attacker could continue to exploit the known flaw.

## Impact

Resizing filesystems is a common activity in cloud-hosted servers. Separate filesystem partitions may prevent successful resizing, or may require the installation of additional tools solely for the purpose of resizing operations. The use of these additional tools may introduce their own security considerations.

## Audit Procedure

### Command Line

```bash
# Run the following command and verify output shows /var/tmp is mounted:
findmnt /var/tmp
```

## Expected Result

```
TARGET    SOURCE    FSTYPE  OPTIONS
/var/tmp  <device>  <fstype> rw,relatime,attr2,inode64,noquota
```

## Remediation

### Command Line

```bash
# For new installations, during installation create a custom partition setup and specify a separate partition for /var/tmp.
# For systems that were previously installed, create a new partition and configure /etc/fstab as appropriate.
```

## Default Value

By default /var/tmp is not configured as a separate partition.

## References

- CIS Controls Version 7 - 5.1 Establish Secure Configurations: Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile

Level 2 - Server / Level 2 - Workstation, Assessment: Automated
