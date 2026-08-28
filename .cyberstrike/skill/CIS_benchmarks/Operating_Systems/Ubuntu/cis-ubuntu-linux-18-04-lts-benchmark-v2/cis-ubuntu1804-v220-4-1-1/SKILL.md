---
name: cis-ubuntu1804-v220-4-1-1
description: "Ensure cron daemon is enabled and active"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, cron, scheduling]
cis_id: "4.1.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.1.1

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The cron daemon is used to execute batch jobs on the system.

## Rationale

While there may not be user jobs that need to be run on the system, the system does have maintenance jobs that may include security monitoring that have to run, and cron is used to execute them.

## Audit Procedure

### Command Line

Run the following command to verify that cron is enabled and active:

```bash
systemctl is-enabled cron
systemctl is-active cron
```

### Expected Result

```
enabled
active
```

## Remediation

### Command Line

Run the following commands to enable and start cron:

```bash
systemctl --now enable cron
```

## References

1. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## CIS Controls

v8 - 4.1 Establish and Maintain a Secure Configuration Process - Establish and maintain a secure configuration process for enterprise assets (end-user devices, including portable and mobile, non-computing/IoT devices, and servers) and software (operating systems and applications).

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
