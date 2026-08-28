---
name: "CIS Ubuntu 14.04 LTS - 4.1.18 Ensure the audit configuration is immutable"
description: "Set audit configuration to immutable mode requiring reboot for changes"
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
  - immutable
  - logging
cis_id: "4.1.18"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 4.1.18 Ensure the audit configuration is immutable (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Set system audit so that audit rules cannot be modified with `auditctl`. Setting the flag "-e 2" forces audit to be put in immutable mode. Audit changes can only be made on system reboot.

## Rationale

In immutable mode, unauthorized users cannot execute changes to the audit system to potentially hide malicious activity and then put the audit rules back. Users would most likely notice a system reboot and that could alert administrators of an attempt to make unauthorized audit changes.

## Audit Procedure

Run the following command and verify output matches:

```bash
grep "^\s*[^#]" /etc/audit/audit.rules | tail -1
```

## Expected Result

```
-e 2
```

## Remediation

Add the following line to the end of the `/etc/audit/audit.rules` file.

```bash
-e 2
```

**Notes:** This setting will ensure reloading the auditd config to set active settings requires a system reboot.

## Default Value

Not configured by default.

## References

1. CIS Controls v6.1 - 3 Secure Configurations for Hardware and Software on Mobile Devices, Laptops, Workstations, and Servers
2. CIS Controls v6.1 - 6 Maintenance, Monitoring, and Analysis of Audit Logs

## Profile

- Level 2 - Server
- Level 2 - Workstation
