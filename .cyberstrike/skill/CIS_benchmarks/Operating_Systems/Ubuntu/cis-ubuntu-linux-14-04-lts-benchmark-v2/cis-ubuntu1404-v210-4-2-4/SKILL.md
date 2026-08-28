---
name: "CIS Ubuntu 14.04 LTS - 4.2.4 Ensure permissions on all logfiles are configured"
description: "Ensure restrictive permissions on all log files in /var/log to protect sensitive data"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - permissions
  - logging
cis_id: "4.2.4"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 4.2.4 Ensure permissions on all logfiles are configured (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Log files stored in `/var/log/` contain logged information from many services on the system, or on log hosts others as well.

## Rationale

It is important to ensure that log files have the correct permissions to ensure that sensitive data is archived and protected.

## Audit Procedure

Run the following command and verify that other has no permissions on any files and group does not have write or execute permissions on any files:

```bash
find /var/log -type f -ls
```

## Expected Result

All log files should have permissions of 640 or more restrictive. No files should have world-readable, world-writable, or world-executable permissions. Group should not have write or execute permissions.

## Remediation

Run the following command to set permissions on all existing log files:

```bash
chmod -R g-wx,o-rwx /var/log/*
```

**Notes:** You may also need to change the configuration for your logging software or services for any logs that had incorrect permissions.

## Default Value

Permissions may vary depending on the logging service and log file.

## References

1. CIS Controls v6.1 - 5.1 Minimize And Sparingly Use Administrative Privileges

## Profile

- Level 1 - Server
- Level 1 - Workstation
