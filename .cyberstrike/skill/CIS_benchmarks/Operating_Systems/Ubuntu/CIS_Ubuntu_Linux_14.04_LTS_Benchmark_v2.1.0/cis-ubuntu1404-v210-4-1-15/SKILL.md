---
name: "CIS Ubuntu 14.04 LTS - 4.1.15 Ensure changes to system administration scope (sudoers) is collected"
description: "Collect audit events for modifications to sudoers configuration files"
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
  - sudoers
  - logging
cis_id: "4.1.15"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 4.1.15 Ensure changes to system administration scope (sudoers) is collected (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Monitor scope changes for system administrations. If the system has been properly configured to force system administrators to log in as themselves first and then use the `sudo` command to execute privileged commands, it is possible to monitor changes in scope. The file `/etc/sudoers` will be written to when the file or its attributes have changed. The audit records will be tagged with the identifier "scope."

## Rationale

Changes in the `/etc/sudoers` file can indicate that an unauthorized change has been made to scope of system administrator activity.

## Audit Procedure

Run the following commands:

```bash
grep scope /etc/audit/audit.rules
auditctl -l | grep scope
```

## Expected Result

Verify output of both matches:

```
-w /etc/sudoers -p wa -k scope
-w /etc/sudoers.d/ -p wa -k scope
```

## Remediation

Add the following line to the `/etc/audit/audit.rules` file:

```bash
-w /etc/sudoers -p wa -k scope
-w /etc/sudoers.d/ -p wa -k scope
```

**Notes:** Reloading the auditd config to set active settings may require a system reboot.

## Default Value

Not configured by default.

## References

1. CIS Controls v6.1 - 5.4 Log Administrative User Addition And Removal

## Profile

- Level 2 - Server
- Level 2 - Workstation
