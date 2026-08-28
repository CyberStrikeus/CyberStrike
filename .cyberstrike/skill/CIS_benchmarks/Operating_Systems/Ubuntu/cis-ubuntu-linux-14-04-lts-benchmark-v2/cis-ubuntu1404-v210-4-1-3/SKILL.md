---
name: "CIS Ubuntu 14.04 LTS - 4.1.3 Ensure auditing for processes that start prior to auditd is enabled"
description: "Configure grub to enable auditing for processes that start before auditd"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-2
  - scored
  - auditd
  - grub
  - logging
cis_id: "4.1.3"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 4.1.3 Ensure auditing for processes that start prior to auditd is enabled (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Configure `grub` so that processes that are capable of being audited can be audited even if they start up prior to `auditd` startup.

## Rationale

Audit events need to be captured on processes that start up prior to `auditd`, so that potential malicious activity cannot go undetected.

## Audit Procedure

Run the following command and verify that each linux line has the `audit=1` parameter set:

```bash
grep "^\s*linux" /boot/grub/grub.cfg
```

## Expected Result

All linux boot lines should contain `audit=1`.

## Remediation

Edit `/etc/default/grub` and add `audit=1` to `GRUB_CMDLINE_LINUX`:

```bash
GRUB_CMDLINE_LINUX="audit=1"
```

Run the following command to update the `grub2` configuration:

```bash
update-grub
```

**Notes:** This recommendation is designed around the grub bootloader, if LILO or another bootloader is in use in your environment enact equivalent settings.

## Default Value

Auditing is not enabled for pre-auditd processes by default.

## References

1. CIS Controls v6.1 - 6.2 Ensure Audit Log Settings Support Appropriate Log Entry Formatting

## Profile

- Level 2 - Server
- Level 2 - Workstation
