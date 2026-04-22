---
name: cis-ubuntu1204-v110-8-1-3
description: "Enable Auditing for Processes That Start Prior to auditd"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, auditd, grub, boot]
cis_id: "8.1.3"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.3 Enable Auditing for Processes That Start Prior to auditd (Scored)

## Profile Applicability
- Level 2

## Description
Configure `grub` or `lilo` so that processes that are capable of being audited can be audited even if they start up prior to `auditd` startup.

## Rationale
Audit events need to be captured on processes that start up prior to `auditd`, so that potential malicious activity cannot go undetected.

## Audit Procedure
### Using Command Line
Perform the following to determine if `/boot/grub/grub.cfg` is configured to log processes that start prior to `auditd`.
```bash
grep "linux" /boot/grub/grub.cfg
```
Make sure each line that starts with linux has the `audit=1` parameter set.

## Expected Result
Each linux boot line should contain `audit=1`.

## Remediation
### Using Command Line
Edit `/etc/default/grub` to include `audit=1` as part of `GRUB_CMDLINE_LINUX`:
```bash
GRUB_CMDLINE_LINUX="audit=1"
```
And run the following command to update the grub configuration:
```bash
update-grub
```

## Default Value
By default, auditing for processes that start prior to auditd is not enabled.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 2 - Scored
