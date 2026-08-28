---
name: cis-ubuntu1604-v200-4-1-1-4
description: "Ensure audit_backlog_limit is sufficient"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, auditd, logging]
cis_id: "4.1.1.4"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.1.1.4

## Profile

- **Level:** 2 - Server
- **Level:** 2 - Workstation
- **Assessment Status:** Automated

## Description

The backlog limit has a default setting of 64.

## Rationale

During boot if audit=1, then the backlog will hold 64 records. If more that 64 records are created during boot, auditd records will be lost and potential malicious activity could go undetected.

## Impact

None.

## Audit Procedure

### Command Line

Run the following commands and verify the `audit_backlog_limit=` parameter is set to an appropriate size for your organization:

```bash
grep "^\s*linux" /boot/grub/grub.cfg | grep -v "audit_backlog_limit="
```

Nothing should be returned.

```bash
grep "audit_backlog_limit=" /boot/grub/grub.cfg
```

Ensure the returned value complies with local site policy. Recommended that this value be 8192 or larger.

## Expected Result

The first command should return no output. The second command should show `audit_backlog_limit=` set to 8192 or larger.

## Remediation

### Command Line

Edit `/etc/default/grub` and add `audit_backlog_limit=<BACKLOG SIZE>` to `GRUB_CMDLINE_LINUX`:

Example:

```bash
GRUB_CMDLINE_LINUX="audit_backlog_limit=8192"
```

Run the following command to update the grub2 configuration:

```bash
update-grub
```

## Default Value

The default backlog limit is 64.

## References

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Section 4.1.1.4

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v7               | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices.                                                                                          |
| v7               | 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |
