---
name: cis-gcp-cos-5.1.7
description: "Ensure SSH MaxAuthTries is set to 4 or less"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, ssh, sshd, sshd-config, authentication]
cis_id: "5.1.7"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.7 Ensure SSH MaxAuthTries is set to 4 or less (Automated)

## Description

The `MaxAuthTries` parameter specifies the maximum number of authentication attempts permitted per connection. When the login failure count reaches half the number, error messages will be written to the `journald` logs detailing the login failure.

## Rationale

Setting the `MaxAuthTries` parameter to a low number will minimize the risk of successful brute force attacks to the SSH server. While the recommended setting is 4, set the number based on site policy.

## Audit Procedure

Run the following command and verify that output `MaxAuthTries` is 4 or less:

```bash
# sshd -T | grep maxauthtries

MaxAuthTries 4
```

## Expected Result

Output should show `MaxAuthTries` set to 4 or less.

## Remediation

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
MaxAuthTries 4
```

## Default Value

MaxAuthTries 6

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 8.2 Collect Audit Logs | x | x | x |
| v7 | 16.13 Alert on Account Login Behavior Deviation | | | x |

## Profile

- Level 2 - Server
