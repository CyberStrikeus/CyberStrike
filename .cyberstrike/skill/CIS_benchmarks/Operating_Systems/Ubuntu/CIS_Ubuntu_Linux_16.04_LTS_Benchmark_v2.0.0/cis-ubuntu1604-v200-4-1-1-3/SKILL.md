---
name: cis-ubuntu1604-v200-4-1-1-3
description: "Ensure auditing for processes that start prior to auditd is enabled"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, auditd, logging]
cis_id: "4.1.1.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.1.1.3

## Profile
- **Level:** 2 - Server
- **Level:** 2 - Workstation
- **Assessment Status:** Automated

## Description

Configure grub so that processes that are capable of being audited can be audited even if they start up prior to auditd startup.

**Note:** This recommendation is designed around the grub bootloader, if LILO or another bootloader is in use in your environment enact equivalent settings. Replace `/boot/grub/grub.cfg` with the appropriate grub configuration file for your environment.

## Rationale

Audit events need to be captured on processes that start up prior to auditd, so that potential malicious activity cannot go undetected.

## Impact

None.

## Audit Procedure

### Command Line

Run the following command and verify that each linux line has the `audit=1` parameter set:

```bash
grep "^\s*linux" /boot/grub/grub.cfg | grep -v "audit=1"
```

## Expected Result

Nothing should be returned.

## Remediation

### Command Line

Edit `/etc/default/grub` and add `audit=1` to `GRUB_CMDLINE_LINUX`:

```bash
GRUB_CMDLINE_LINUX="audit=1"
```

Run the following command to update the grub2 configuration:

```bash
update-grub
```

## Default Value

By default, auditing is not enabled for processes that start prior to auditd.

## References

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Section 4.1.1.3

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices. |
| v7 | 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |
