---
name: cis-gcp-cos-5.1.19
description: "Ensure SSH PAM is enabled"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, ssh, sshd, sshd-config, authentication]
cis_id: "5.1.19"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.19 Ensure SSH PAM is enabled (Automated)

## Description

UsePAM Enables the Pluggable Authentication Module interface. If set to "yes" this will enable PAM authentication using ChallengeResponseAuthentication and PasswordAuthentication in addition to PAM account and session module processing for all authentication types.

## Rationale

When usePAM is set to yes, PAM runs through account and session types properly. This is important if you want to restrict access to services based off of IP, time or other factors of the account. Additionally, you can make sure users inherit certain environment variables on login or disallow access to the server.

## Impact

If UsePAM is enabled, you will not be able to run sshd(8) as a non-root user.

## Audit Procedure

Run the following command and verify that output matches:

```bash
# sshd -T | grep -i usepam

usepam yes
```

## Expected Result

Output should show `usepam yes`.

## Remediation

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
UsePAM yes
```

## Default Value

usePAM yes

## CIS Controls

| Controls Version | Control                                           | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------- | ---- | ---- | ---- |
| v8               | 6.8 Define and Maintain Role-Based Access Control |      |      | x    |
| v7               | 5.1 Establish Secure Configurations               | x    | x    | x    |

## Profile

- Level 1 - Server
