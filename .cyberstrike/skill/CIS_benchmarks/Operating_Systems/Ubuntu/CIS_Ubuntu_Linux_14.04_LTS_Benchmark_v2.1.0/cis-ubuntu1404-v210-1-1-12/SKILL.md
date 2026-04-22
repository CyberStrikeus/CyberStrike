---
name: "CIS Ubuntu 14.04 LTS - 1.1.12 Ensure separate partition exists for /home"
description: "Ensure a separate partition exists for /home to protect user data"
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
cis_id: "1.1.12"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 1.1.12 Ensure separate partition exists for /home (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

The /home directory is used to support disk storage needs of local users.

## Rationale

If the system is intended to support local users, create a separate partition for the /home directory to protect against resource exhaustion and restrict the type of files that can be stored under /home.

## Audit Procedure

```bash
mount | grep /home
# Expected output: /dev/xvdf1 on /home type ext4 (rw,nodev,relatime,data=ordered)
```

## Expected Result

Verify output shows /home is mounted on a separate partition.

## Remediation

```bash
# For new installations, during installation create a custom partition setup
# and specify a separate partition for /home.
# For systems that were previously installed, create a new partition and
# configure /etc/fstab as appropriate.
```

## Default Value

By default, /home is not mounted on a separate partition.

## References

- CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0
- AJ Lewis, "LVM HOWTO", http://tldp.org/HOWTO/LVM-HOWTO/

## Profile

- Level 2
