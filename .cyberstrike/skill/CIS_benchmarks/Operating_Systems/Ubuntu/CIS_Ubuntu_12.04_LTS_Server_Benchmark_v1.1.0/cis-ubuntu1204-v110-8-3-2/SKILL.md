---
name: cis-ubuntu1204-v110-8-3-2
description: "Implement Periodic Execution of File Integrity"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, logging, aide, file-integrity, cron, periodic]
cis_id: "8.3.2"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 8.3.2 Implement Periodic Execution of File Integrity (Scored)

## Profile Applicability

- Level 2

## Description

Implement periodic file checking, in compliance with site policy.

## Rationale

Periodic file checking allows the system administrator to determine on a regular basis if critical files have been changed in an unauthorized fashion.

## Audit Procedure

### Using Command Line

Perform the following to determine if there is a `cron` job scheduled to run the aide check.

```bash
crontab -u root -l | grep aide
```

## Expected Result

```
0 5 * * * /usr/sbin/aide --check
```

## Remediation

### Using Command Line

Execute the following command:

```bash
crontab -u root -e
```

Add the following line to the crontab:

```bash
0 5 * * * /usr/sbin/aide --check
```

**Note:** The checking in this instance occurs every day at 5am. Alter the frequency and time of the checks in compliance with site policy.

## Default Value

By default, no periodic file integrity checking is configured.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 2 - Scored
