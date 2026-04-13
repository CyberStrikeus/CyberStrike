---
name: cis-gcp-cos-5.1.22
description: "Ensure SSH MaxSessions is set to 4 or less"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, ssh, sshd, sshd-config]
cis_id: "5.1.22"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.22 Ensure SSH MaxSessions is set to 4 or less (Automated)

## Description

The `MaxSessions` parameter specifies the maximum number of open sessions permitted from a given connection.

## Rationale

To protect a system from denial of service due to a large number of concurrent sessions, use the rate limiting function of MaxSessions to protect availability of sshd logins and prevent overwhelming the daemon.

## Audit Procedure

Run the following command and verify that output `MaxSessions` is 4 or less, or matches site policy:

```bash
# sshd -T | grep -i maxsessions
# maxsessions 4
```

## Expected Result

Output should show `maxsessions 4` or less, or match site policy.

## Remediation

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
MaxSessions 4
```

## CIS Controls

| Controls Version | Control                             | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------- | ---- | ---- | ---- |
| v7               | 5.1 Establish Secure Configurations | x    | x    | x    |

## Profile

- Level 2 - Server
