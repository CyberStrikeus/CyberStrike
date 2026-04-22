---
name: "CIS Ubuntu 14.04 LTS - 5.2.3 Ensure SSH LogLevel is set to INFO"
description: "Verify SSH LogLevel is configured to INFO for adequate logging of login activity"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - ssh
cis_id: "5.2.3"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 5.2.3 Ensure SSH LogLevel is set to INFO (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `INFO` parameter specifies that login and logout activity will be logged.

## Rationale

SSH provides several logging levels with varying amounts of verbosity. `DEBUG` is specifically _not_ recommended other than strictly for debugging SSH communications since it provides so much data that it is difficult to identify important security information. `INFO` level is the basic level that only records login activity of SSH users. In many situations, such as Incident Response, it is important to determine when a particular user was active on a system. The logout record can eliminate those users who disconnected, which helps narrow the field.

## Audit Procedure

Run the following command and verify that output matches:

```bash
grep "^LogLevel" /etc/ssh/sshd_config
```

## Expected Result

```
LogLevel INFO
```

## Remediation

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
LogLevel INFO
```

## Default Value

LogLevel INFO

## References

- CIS Controls: 16 - Account Monitoring and Control

## Profile

- Level 1 - Server
- Level 1 - Workstation
