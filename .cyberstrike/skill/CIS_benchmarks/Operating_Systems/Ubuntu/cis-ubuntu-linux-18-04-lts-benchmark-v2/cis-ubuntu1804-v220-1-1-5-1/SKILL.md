---
name: cis-ubuntu1804-v220-1-1-5-1
description: "Ensure separate partition exists for /var/log"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, partition, var-log, mount, logging]
cis_id: "1.1.5.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure separate partition exists for /var/log

## Profile

Level 2 - Server / Level 2 - Workstation, Assessment: Automated

## Description

The /var/log directory is used by system services to store log data.

## Rationale

There are two important reasons to ensure that system logs are stored on a separate partition: protection against resource exhaustion (since logs can grow quite large) and protection of audit data.

## Impact

Resizing filesystems is a common activity in cloud-hosted servers. Separate filesystem partitions may prevent tying the overall disk management to one large volume. It may be necessary to use Logical Volume Management (LVM) or similar tools to create a flexible partitioning scheme for /var/log.

## Audit Procedure

### Command Line

Run the following command and verify the output shows that /var/log is mounted:

```bash
# findmnt -kn /var/log
```

## Expected Result

```
/var/log     /dev/sda4  ext4   rw,nosuid,nodev,noexec,relatime
```

## Remediation

### Command Line

For specific configuration requirements of the /var/log mount for your environment, modify /etc/fstab:

```bash
# Configure /etc/fstab as appropriate:
# Example:
# <device> /var/log   <fstype>   defaults,rw,nosuid,nodev,noexec,relatime   0 0
```

Creating a new partition is a destructive operation that typically requires a reinstallation or use of LVM.

## Default Value

By default /var/log is not a separate partition.

## References

1. http://tldp.org/HOWTO/LVM-HOWTO/
2. NIST SP 800-53 Rev. 5: AU-8

## CIS Controls

v8 - 8.3 Ensure Adequate Audit Log Storage (IG 1, IG 2, IG 3)
v7 - 6.4 Ensure adequate storage for logs (IG 2, IG 3)

MITRE ATT&CK Mappings: T1499, T1499.001 (TA0005) - M1022
