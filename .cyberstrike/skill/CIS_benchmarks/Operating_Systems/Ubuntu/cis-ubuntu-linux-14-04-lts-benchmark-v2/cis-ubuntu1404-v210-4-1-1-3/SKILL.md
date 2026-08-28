---
name: "CIS Ubuntu 14.04 LTS - 4.1.1.3 Ensure audit logs are not automatically deleted"
description: "Configure auditd to retain all audit logs by setting max_log_file_action to keep_logs"
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
cis_id: "4.1.1.3"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 4.1.1.3 Ensure audit logs are not automatically deleted (Scored)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

The `max_log_file_action` setting determines how to handle the audit log file reaching the max file size. A value of `keep_logs` will rotate the logs but never delete old logs.

## Rationale

In high security contexts, the benefits of maintaining a long audit history exceed the cost of storing the audit history.

## Audit Procedure

Run the following command and verify output matches:

```bash
grep max_log_file_action /etc/audit/auditd.conf
```

## Expected Result

```
max_log_file_action = keep_logs
```

## Remediation

Set the following parameter in `/etc/audit/auditd.conf`:

```bash
max_log_file_action = keep_logs
```

## Default Value

Not configured to `keep_logs` by default.

## References

1. CIS Controls v6.1 - 6.3 Ensure Audit Logging Systems Are Not Subject To Loss

## Profile

- Level 2 - Server
- Level 2 - Workstation
