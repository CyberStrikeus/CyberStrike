---
name: cis-ubuntu1804-v220-1-1-6-1
description: "Ensure separate partition exists for /var/log/audit"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, partition, var-log-audit, mount, logging, auditing]
cis_id: "1.1.6.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure separate partition exists for /var/log/audit

## Profile

Level 2 - Server / Level 2 - Workstation, Assessment: Automated

## Description

The auditing daemon, auditd, stores log data in the /var/log/audit directory.

## Rationale

There are two important reasons to ensure that data gathered by auditd is stored on a separate partition: protection against resource exhaustion (since the audit.log file can grow quite large) and protection of audit data. The audit daemon calculates how much free space is left and performs actions based on the results. If other processes (such as syslog) consume space in the same partition as auditd, it may not perform as desired.

## Impact

Resizing filesystems is a common activity in cloud-hosted servers. Separate filesystem partitions may prevent tying the overall disk management to one large volume. It may be necessary to use Logical Volume Management (LVM) or similar tools to create a flexible partitioning scheme for /var/log/audit.

## Audit Procedure

### Command Line

Run the following command and verify the output shows that /var/log/audit is mounted:

```bash
# findmnt -kn /var/log/audit
```

## Expected Result

```
/var/log/audit     /dev/sda5  ext4   rw,nosuid,nodev,noexec,relatime
```

## Remediation

### Command Line

For specific configuration requirements of the /var/log/audit mount for your environment, modify /etc/fstab:

```bash
# Configure /etc/fstab as appropriate:
# Example:
# <device> /var/log/audit   <fstype>   defaults,rw,nosuid,nodev,noexec,relatime   0 0
```

Creating a new partition is a destructive operation that typically requires a reinstallation or use of LVM.

## Default Value

By default /var/log/audit is not a separate partition.

## References

1. http://tldp.org/HOWTO/LVM-HOWTO/
2. NIST SP 800-53 Rev. 5: AU-8

## CIS Controls

v8 - 8.3 Ensure Adequate Audit Log Storage (IG 1, IG 2, IG 3)
v7 - 6.4 Ensure adequate storage for logs (IG 2, IG 3)

MITRE ATT&CK Mappings: T1499, T1499.001 (TA0005) - M1022
