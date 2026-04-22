---
name: "CIS Ubuntu 14.04 LTS - 1.1.11 Ensure separate partition exists for /var/log/audit"
description: "Ensure a separate partition exists for /var/log/audit to protect audit data"
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
cis_id: "1.1.11"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 1.1.11 Ensure separate partition exists for /var/log/audit (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

The auditing daemon, auditd, stores log data in the /var/log/audit directory.

## Rationale

There are two important reasons to ensure that data gathered by auditd is stored on a separate partition: protection against resource exhaustion (since the audit.log file can grow quite large) and protection of audit data. The audit daemon calculates how much free space is left and performs actions based on the results. If other processes (such as syslog) consume space in the same partition as auditd, it may not perform as desired.

## Audit Procedure

```bash
mount | grep /var/log/audit
# Expected output: /dev/xvdi1 on /var/log/audit type ext4 (rw,relatime,data=ordered)
```

## Expected Result

Verify output shows /var/log/audit is mounted on a separate partition.

## Remediation

```bash
# For new installations, during installation create a custom partition setup
# and specify a separate partition for /var/log/audit.
# For systems that were previously installed, create a new partition and
# configure /etc/fstab as appropriate.
```

## Default Value

By default, /var/log/audit is not mounted on a separate partition.

## References

- CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0
- AJ Lewis, "LVM HOWTO", http://tldp.org/HOWTO/LVM-HOWTO/
- CIS Controls: 6.3 Ensure Audit Logging Systems Are Not Subject To Loss

## Profile

- Level 2
