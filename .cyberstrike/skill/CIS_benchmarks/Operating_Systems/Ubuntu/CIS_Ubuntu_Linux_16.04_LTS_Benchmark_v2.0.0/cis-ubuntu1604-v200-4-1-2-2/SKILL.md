---
name: cis-ubuntu1604-v200-4-1-2-2
description: "Ensure audit logs are not automatically deleted"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, auditd, logging]
cis_id: "4.1.2.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.1.2.2

## Profile

- **Level:** 2 - Server
- **Level:** 2 - Workstation
- **Assessment Status:** Automated

## Description

The `max_log_file_action` setting determines how to handle the audit log file reaching the max file size. A value of `keep_logs` will rotate the logs but never delete old logs.

## Rationale

In high security contexts, the benefits of maintaining a long audit history exceed the cost of storing the audit history.

## Impact

None.

## Audit Procedure

### Command Line

Run the following command and verify output matches:

```bash
grep max_log_file_action /etc/audit/auditd.conf
```

## Expected Result

```
max_log_file_action = keep_logs
```

## Remediation

### Command Line

Set the following parameter in `/etc/audit/auditd.conf`:

```bash
max_log_file_action = keep_logs
```

## Default Value

The default value is `ROTATE`.

## References

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Section 4.1.2.2

## CIS Controls

| Controls Version | Control                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| v7               | 6.4 Ensure adequate storage for logs - Ensure that all systems that store logs have adequate storage space for the logs generated. |
