---
name: "CIS Ubuntu 14.04 LTS - 4.1.2 Ensure auditd service is enabled"
description: "Enable the auditd daemon to record system events for security monitoring"
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
  - logging
cis_id: "4.1.2"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 4.1.2 Ensure auditd service is enabled (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Turn on the `auditd` daemon to record system events.

## Rationale

The capturing of system events provides system administrators with information to allow them to determine if unauthorized access to their system is occurring.

## Audit Procedure

Run the following to ensure proper start links for `auditd` exist in `/etc/rc*.d`:

```bash
ls /etc/rc*.d/S*auditd
```

## Expected Result

```
/etc/rc2.d/S37auditd  /etc/rc3.d/S37auditd  /etc/rc4.d/S37auditd
/etc/rc5.d/S37auditd
```

Start links should exist for run levels 2, 3, 4, and 5.

## Remediation

Run the following command to enable `auditd`:

```bash
update-rc.d auditd enable
```

## Default Value

Not enabled by default on all installations.

## References

1. CIS Controls v6.1 - 6.2 Ensure Audit Log Settings Support Appropriate Log Entry Formatting

## Profile

- Level 2 - Server
- Level 2 - Workstation
