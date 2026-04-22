---
name: cis-ubuntu1604-v200-4-2-3
description: "Ensure permissions on all logfiles are configured"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, logging, rsyslog]
cis_id: "4.2.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.2.3

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

Log files stored in `/var/log/` contain logged information from many services on the system, or on log hosts others as well.

**Note:** You may also need to change the configuration for your logging software or services for any logs that had incorrect permissions.

## Rationale

It is important to ensure that log files have the correct permissions to ensure that sensitive data is archived and protected.

## Impact

None.

## Audit Procedure

Run the following command and verify that other has no permissions on any files and group does not have write or execute permissions on any files:

### Command Line

```bash
find /var/log -type f -ls
```

## Expected Result

No files should have permissions granting write or execute to group, or any permissions to other.

## Remediation

Run the following commands to set permissions on all existing log files:

### Command Line

```bash
find /var/log -type f -exec chmod g-wx,o-rwx "{}" + -o -type d -exec chmod g-wx,o-rwx "{}" +
```

## Default Value

System log file permissions vary by distribution.

## References

None.

## CIS Controls

| Controls Version | Control                                | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------- | ---- | ---- | ---- |
| v7               | 13 Data Protection<br/>Data Protection |      |      |      |
