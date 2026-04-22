---
name: "CIS Ubuntu 14.04 LTS - 1.1.5 Ensure separate partition exists for /var"
description: "Ensure a separate partition exists for /var to prevent resource exhaustion"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-2
  - scored
  - filesystem
cis_id: "1.1.5"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 1.1.5 Ensure separate partition exists for /var (Scored)

## Profile Applicability
- Level 2 - Server
- Level 2 - Workstation

## Description
The /var directory is used by daemons and other system services to temporarily store dynamic data. Some directories created by these processes may be world-writable.

## Rationale
Since the /var directory may contain world-writable files and directories, there is a risk of resource exhaustion if it is not bound to a separate partition.

## Audit Procedure
```bash
mount | grep /var
# Expected output: /dev/xvdg1 on /var type ext4 (rw,relatime,data=ordered)
```

## Expected Result
Verify output shows /var is mounted on a separate partition.

## Remediation
```bash
# For new installations, during installation create a custom partition setup
# and specify a separate partition for /var.
# For systems that were previously installed, create a new partition and
# configure /etc/fstab as appropriate.
```

## Default Value
By default, /var is not mounted on a separate partition.

## References
- CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0
- AJ Lewis, "LVM HOWTO", http://tldp.org/HOWTO/LVM-HOWTO/

## Profile
- Level 2
