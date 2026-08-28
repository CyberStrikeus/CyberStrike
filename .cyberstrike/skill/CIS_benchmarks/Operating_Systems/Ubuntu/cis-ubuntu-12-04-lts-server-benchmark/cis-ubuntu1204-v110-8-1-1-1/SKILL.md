---
name: cis-ubuntu1204-v110-8-1-1-1
description: "Configure Audit Log Storage Size"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, auditd, audit-log, storage]
cis_id: "8.1.1.1"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.1.1.1 Configure Audit Log Storage Size (Not Scored)

## Profile Applicability

- Level 2

## Description

Configure the maximum size of the audit log file. Once the log reaches the maximum size, it will be rotated and a new log file will be started.

## Rationale

It is important that an appropriate size is determined for log files so that they do not impact the system and audit data is not lost.

## Audit Procedure

### Using Command Line

Perform the following to determine the maximum size of the audit log files.

```bash
grep max_log_file /etc/audit/auditd.conf
```

## Expected Result

```
max_log_file = <MB>
```

## Remediation

### Using Command Line

Set the `max_log_file` parameter in `/etc/audit/auditd.conf`:

```bash
max_log_file = <MB>
```

**Note:** `MB` is the number of MegaBytes the file can be.

## Default Value

By default, auditd will max out the log files at 5MB and retain only 4 copies of them.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 2 - Not Scored
