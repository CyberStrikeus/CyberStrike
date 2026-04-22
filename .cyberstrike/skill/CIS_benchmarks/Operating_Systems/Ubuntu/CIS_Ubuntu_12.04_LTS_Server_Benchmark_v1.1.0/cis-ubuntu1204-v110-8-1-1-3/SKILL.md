---
name: cis-ubuntu1204-v110-8-1-1-3
description: "Keep All Auditing Information"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, auditd, audit-log, retention]
cis_id: "8.1.1.3"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.1.3 Keep All Auditing Information (Scored)

## Profile Applicability
- Level 2

## Description
Normally, `auditd` will hold 4 logs of maximum log file size before deleting older log files.

## Rationale
In high security contexts, the benefits of maintaining a long audit history exceed the cost of storing the audit history.

## Audit Procedure
### Using Command Line
Perform the following to determine if audit logs are retained.
```bash
grep max_log_file_action /etc/audit/auditd.conf
```

## Expected Result
```
max_log_file_action = keep_logs
```

## Remediation
### Using Command Line
Add the following line to the `/etc/audit/auditd.conf` file:
```bash
max_log_file_action = keep_logs
```

## Default Value
By default, auditd retains only 4 copies of log files.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 2 - Scored
