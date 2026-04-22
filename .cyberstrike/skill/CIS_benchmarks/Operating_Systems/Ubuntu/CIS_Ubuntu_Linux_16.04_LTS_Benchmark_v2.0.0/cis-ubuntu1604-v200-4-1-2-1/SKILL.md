---
name: cis-ubuntu1604-v200-4-1-2-1
description: "Ensure audit log storage size is configured"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, auditd, logging]
cis_id: "4.1.2.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.1.2.1

## Profile
- **Level:** 2 - Server
- **Level:** 2 - Workstation
- **Assessment Status:** Automated

## Description

Configure the maximum size of the audit log file. Once the log reaches the maximum size, it will be rotated and a new log file will be started.

**Notes:**
- The `max_log_file` parameter is measured in megabytes
- Other methods of log rotation may be appropriate based on site policy. One example is time-based rotation strategies which don't have native support in auditd configurations
- Manual audit of custom configurations should be evaluated for effectiveness and completeness

## Rationale

It is important that an appropriate size is determined for log files so that they do not impact the system and audit data is not lost.

## Impact

None.

## Audit Procedure

### Command Line

Run the following command and ensure output is in compliance with site policy:

```bash
grep max_log_file /etc/audit/auditd.conf
```

## Expected Result

```
max_log_file = <MB>
```

The value should be set in accordance with site policy.

## Remediation

### Command Line

Set the following parameter in `/etc/audit/auditd.conf` in accordance with site policy:

```bash
max_log_file = <MB>
```

## Default Value

The default max_log_file is 8 MB.

## References

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Section 4.1.2.1

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 6.4 Ensure adequate storage for logs - Ensure that all systems that store logs have adequate storage space for the logs generated. |
