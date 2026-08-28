---
name: cis-ubuntu1604-v200-4-1-2-3
description: "Ensure system is disabled when audit logs are full"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, auditd, logging]
cis_id: "4.1.2.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.1.2.3

## Profile

- **Level:** 2 - Server
- **Level:** 2 - Workstation
- **Assessment Status:** Automated

## Description

The auditd daemon can be configured to halt the system when the audit logs are full.

## Rationale

In high security contexts, the risk of detecting unauthorized access or nonrepudiation exceeds the benefit of the system's availability.

## Impact

If the system is configured to halt when audit logs are full, the system will stop when disk space is exhausted for audit logs.

## Audit Procedure

### Command Line

Run the following commands and verify output matches:

```bash
grep space_left_action /etc/audit/auditd.conf
```

```bash
grep action_mail_acct /etc/audit/auditd.conf
```

```bash
grep admin_space_left_action /etc/audit/auditd.conf
```

## Expected Result

```
space_left_action = email
action_mail_acct = root
admin_space_left_action = halt
```

## Remediation

### Command Line

Set the following parameters in `/etc/audit/auditd.conf`:

```bash
space_left_action = email
action_mail_acct = root
admin_space_left_action = halt
```

## Default Value

By default, auditd does not halt the system when logs are full.

## References

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Section 4.1.2.3

## CIS Controls

| Controls Version | Control                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| v7               | 6.4 Ensure adequate storage for logs - Ensure that all systems that store logs have adequate storage space for the logs generated. |
