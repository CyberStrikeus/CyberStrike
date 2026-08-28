---
name: cis-ubuntu1804-v220-1-1-3-1
description: "Ensure separate partition exists for /var"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, partition, var, mount]
cis_id: "1.1.3.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure separate partition exists for /var

## Profile

Level 2 - Server / Level 2 - Workstation, Assessment: Automated

## Description

The /var directory is used by daemons and other system services to temporarily store dynamic data. Some directories created by these processes may be world-writable.

## Rationale

The reasoning for mounting /var on a separate partition is to provide protection in case of a software or configuration error that causes excessive disk consumption in /var. Since /var contains the bulk of dynamic system data such as logs, mail spools, and package manager cache, isolating it prevents a runaway process from filling the root filesystem.

## Impact

Resizing filesystems is a common activity in cloud-hosted servers. Separate filesystem partitions may prevent tying the overall disk management to one large volume. It may be necessary to use Logical Volume Management (LVM) or similar tools to create a flexible partitioning scheme for /var.

## Audit Procedure

### Command Line

Run the following command and verify the output shows that /var is mounted:

```bash
# findmnt -kn /var
```

## Expected Result

```
/var     /dev/sda2  ext4   rw,relatime,seclabel
```

## Remediation

### Command Line

For specific configuration requirements of the /var mount for your environment, modify /etc/fstab:

```bash
# Configure /etc/fstab as appropriate:
# Example:
# <device> /var   <fstype>   defaults,rw,nosuid,nodev,relatime   0 0
```

Creating a new partition is a destructive operation that typically requires a reinstallation or use of LVM.

## Default Value

By default /var is not a separate partition.

## References

1. http://tldp.org/HOWTO/LVM-HOWTO/
2. NIST SP 800-53 Rev. 4: MP-2, AC-3

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists (IG 1, IG 2, IG 3)
v7 - 14.6 Protect Information through Access Control Lists (IG 1, IG 2, IG 3)

MITRE ATT&CK Mappings: T1499, T1499.001 (TA0006) - M1022
