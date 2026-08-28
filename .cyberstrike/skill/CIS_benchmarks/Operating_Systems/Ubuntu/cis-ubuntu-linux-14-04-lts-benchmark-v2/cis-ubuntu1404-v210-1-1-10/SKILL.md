---
name: "CIS Ubuntu 14.04 LTS - 1.1.10 Ensure separate partition exists for /var/log"
description: "Ensure a separate partition exists for /var/log to protect log data"
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
cis_id: "1.1.10"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 1.1.10 Ensure separate partition exists for /var/log (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

The /var/log directory is used by system services to store log data.

## Rationale

There are two important reasons to ensure that system logs are stored on a separate partition: protection against resource exhaustion (since logs can grow quite large) and protection of audit data.

## Audit Procedure

```bash
mount | grep /var/log
# Expected output: /dev/xvdh1 on /var/log type ext4 (rw,relatime,data=ordered)
```

## Expected Result

Verify output shows /var/log is mounted on a separate partition.

## Remediation

```bash
# For new installations, during installation create a custom partition setup
# and specify a separate partition for /var/log.
# For systems that were previously installed, create a new partition and
# configure /etc/fstab as appropriate.
```

## Default Value

By default, /var/log is not mounted on a separate partition.

## References

- CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0
- AJ Lewis, "LVM HOWTO", http://tldp.org/HOWTO/LVM-HOWTO/
- CIS Controls: 6.3 Ensure Audit Logging Systems Are Not Subject To Loss

## Profile

- Level 2
