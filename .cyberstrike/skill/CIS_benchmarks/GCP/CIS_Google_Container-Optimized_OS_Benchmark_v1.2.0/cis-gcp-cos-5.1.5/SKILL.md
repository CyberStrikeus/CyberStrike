---
name: cis-gcp-cos-5.1.5
description: "Ensure SSH LogLevel is appropriate"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, ssh, sshd, sshd-config, authentication]
cis_id: "5.1.5"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.5 Ensure SSH LogLevel is appropriate (Automated)

## Description

`INFO` level is the basic level that only records login activity of SSH users. In many situations, such as Incident Response, it is important to determine when a particular user was active on a system. The logout record can eliminate those users who disconnected, which helps narrow the field.

`VERBOSE` level specifies that login and logout activity as well as the key fingerprint for any SSH key used for login will be logged. This information is important for SSH key management, especially in legacy environments.

## Rationale

SSH provides several logging levels with varying amounts of verbosity. `DEBUG` is specifically not recommended other than strictly for debugging SSH communications since it provides so much data that it is difficult to identify important security information.

## Audit Procedure

Run the following command and verify that output matches:

```bash
# sshd -T | grep loglevel
LogLevel VERBOSE

OR

loglevel INFO
```

## Expected Result

Output should show `LogLevel VERBOSE` or `loglevel INFO`.

## Remediation

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
LogLevel VERBOSE
```

OR

```
LogLevel INFO
```

## Default Value

LogLevel INFO

## References

1. https://www.ssh.com/ssh/sshd_config/

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 8.2 Collect Audit Logs | x | x | x |
| v8 | 8.5 Collect Detailed Audit Logs | | x | x |
| v7 | 6.2 Activate audit logging | x | x | x |
| v7 | 6.3 Enable Detailed Logging | | x | x |

## Profile

- Level 1 - Server
