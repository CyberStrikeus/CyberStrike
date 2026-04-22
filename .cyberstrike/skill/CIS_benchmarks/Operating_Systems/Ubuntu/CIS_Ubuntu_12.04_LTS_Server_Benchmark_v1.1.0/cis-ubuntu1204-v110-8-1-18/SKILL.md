---
name: cis-ubuntu1204-v110-8-1-18
description: "Make the Audit Configuration Immutable"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, auditd, immutable, audit-rules]
cis_id: "8.1.18"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.18 Make the Audit Configuration Immutable (Scored)

## Profile Applicability

- Level 2

## Description

Set system audit so that audit rules cannot be modified with `auditctl`. Setting the flag "-e 2" forces audit to be put in immutable mode. Audit changes can only be made on system reboot.

## Rationale

In immutable mode, unauthorized users cannot execute changes to the audit system to potentially hide malicious activity and then put the audit rules back. Users would most likely notice a system reboot and that could alert administrators of an attempt to make unauthorized audit changes.

## Audit Procedure

### Using Command Line

Perform the following to determine if the audit configuration is immutable.

```bash
tail -n 1 /etc/audit/audit.rules
```

## Expected Result

```
-e 2
```

## Remediation

### Using Command Line

Add the following lines to the `/etc/audit/audit.rules` file:

```bash
-e 2
```

**Note:** This must be the last line in the `/etc/audit/audit.rules` file.

## Default Value

By default, the audit configuration is not immutable.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 2 - Scored
