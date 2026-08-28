---
name: cis-ubuntu1804-v220-1-1-4-1
description: "Ensure separate partition exists for /var/tmp"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, partition, var-tmp, mount]
cis_id: "1.1.4.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure separate partition exists for /var/tmp

## Profile

Level 2 - Server / Level 2 - Workstation, Assessment: Automated

## Description

The /var/tmp directory is a world-writable directory used for temporary storage by all users and some applications.

## Rationale

Since the /var/tmp directory is intended to be world-writable, there is a risk of resource exhaustion if it is not bound to a separate partition. In addition, making /var/tmp its own file system allows an administrator to set additional mount options such as the noexec option on the mount, making /var/tmp useless for an attacker to install executable code.

## Impact

Resizing filesystems is a common activity in cloud-hosted servers. Separate filesystem partitions may prevent tying the overall disk management to one large volume. It may be necessary to use Logical Volume Management (LVM) or similar tools to create a flexible partitioning scheme for /var/tmp.

## Audit Procedure

### Command Line

Run the following command and verify the output shows that /var/tmp is mounted:

```bash
# findmnt -kn /var/tmp
```

## Expected Result

```
/var/tmp     /dev/sda3  ext4   rw,nosuid,nodev,noexec,relatime
```

## Remediation

### Command Line

For specific configuration requirements of the /var/tmp mount for your environment, modify /etc/fstab:

```bash
# Configure /etc/fstab as appropriate:
# Example:
# <device> /var/tmp   <fstype>   defaults,rw,nosuid,nodev,noexec,relatime   0 0
```

Creating a new partition is a destructive operation that typically requires a reinstallation or use of LVM.

## Default Value

By default /var/tmp is not a separate partition.

## References

1. http://tldp.org/HOWTO/LVM-HOWTO/
2. NIST SP 800-53 Rev. 5: CM-6

## CIS Controls

v8 - 3.3 Configure Data Access Control Lists (IG 1, IG 2, IG 3)
v7 - 14.6 Protect Information through Access Control Lists (IG 1, IG 2, IG 3)

MITRE ATT&CK Mappings: T1499, T1499.001 (TA0005) - M1022
