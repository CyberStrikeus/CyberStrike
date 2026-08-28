---
name: cis-ubuntu2004-v300-2-4-1-1
description: "Ensure cron daemon is enabled and active"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, cron, job-schedulers]
cis_id: "2.4.1.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure cron daemon is enabled and active

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The cron daemon is used to execute batch jobs on the system.

## Rationale

While there may not be user jobs that need to be run on the system, the system does have maintenance jobs that may include security monitoring that have to run, and cron is used to execute them.

## Audit

- IF - cron is installed on the system:

Run the following command to verify cron is enabled:

### Command Line

```bash
# systemctl list-unit-files | awk '$1~/cron[d]?\.service/{print $2}'
```

**Output:**

```
enabled
```

Run the following command to verify that cron is active:

```bash
# systemctl list-units | awk '$1~/cron[d]?\.service/{print $3}'
```

**Output:**

```
active
```

## Remediation

- IF - cron is installed on the system:

Run the following commands to unmask, enable, and start cron:

### Command Line

```bash
# systemctl unmask "$(systemctl list-unit-files | awk '$1~/^cron[d]?\.service/{print $1}')"
# systemctl --now enable "$(systemctl list-unit-files | awk '$1~/cron[d]?\.service/{print $1}')"
```

## References

1. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v8               | 0.0 Explicitly Not Mapped<br/>Explicitly Not Mapped |      |      |      |
| v7               | 0.0 Explicitly Not Mapped<br/>Explicitly Not Mapped |      |      |      |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1562, T1562.001            | TA0005  | M1018       |
