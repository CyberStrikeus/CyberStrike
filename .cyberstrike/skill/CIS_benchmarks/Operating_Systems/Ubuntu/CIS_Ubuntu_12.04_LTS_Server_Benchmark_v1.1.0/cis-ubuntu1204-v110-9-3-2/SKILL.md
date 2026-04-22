---
name: cis-ubuntu1204-v110-9-3-2
description: "Set LogLevel to INFO"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, authentication, ssh, logging]
cis_id: "9.3.2"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 9.3.2 Set LogLevel to INFO (Scored)

## Profile Applicability
- Level 1

## Description
The `INFO` parameter specifies that login and logout activity will be logged.

## Rationale
SSH provides several logging levels with varying amounts of verbosity. `DEBUG` is specifically *not* recommended other than strictly for debugging SSH communications since it provides so much data that it is difficult to identify important security information. `INFO` level is the basic level that only records login activity of SSH users. In many situations, such as Incident Response, it is important to determine when a particular user was active on a system. The logout record can eliminate those users who disconnected, which helps narrow the field.

## Audit Procedure
### Using Command Line
To verify the correct SSH setting, run the following command and verify that the output is as shown:
```bash
grep "^LogLevel" /etc/ssh/sshd_config
```

## Expected Result
```
LogLevel INFO
```

## Remediation
### Using Command Line
Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:
```bash
LogLevel INFO
```

## Default Value
LogLevel INFO

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
