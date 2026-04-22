---
name: "CIS Ubuntu 14.04 LTS - 4.1.1.2 Ensure system is disabled when audit logs are full"
description: "Configure auditd to halt the system when audit logs are full to prevent loss of audit data"
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
cis_id: "4.1.1.2"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 4.1.1.2 Ensure system is disabled when audit logs are full (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

The `auditd` daemon can be configured to halt the system when the audit logs are full.

## Rationale

In high security contexts, the risk of detecting unauthorized access or nonrepudiation exceeds the benefit of the system's availability.

## Audit Procedure

Run the following commands and verify output matches:

```bash
grep space_left_action /etc/audit/auditd.conf
grep action_mail_acct /etc/audit/auditd.conf
grep admin_space_left_action /etc/audit/auditd.conf
```

## Expected Result

```
space_left_action = email
action_mail_acct = root
admin_space_left_action = halt
```

## Remediation

Set the following parameters in `/etc/audit/auditd.conf`:

```bash
space_left_action = email
action_mail_acct = root
admin_space_left_action = halt
```

## Default Value

Not configured by default.

## References

1. CIS Controls v6.1 - 6.3 Ensure Audit Logging Systems Are Not Subject To Loss

## Profile

- Level 2 - Server
- Level 2 - Workstation
