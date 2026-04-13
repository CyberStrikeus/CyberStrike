---
name: cis-gcp-cos-5.1.16
description: "Ensure SSH Idle Timeout Interval is configured"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, ssh, sshd, sshd-config]
cis_id: "5.1.16"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.16 Ensure SSH Idle Timeout Interval is configured (Automated)

## Description

The two options `ClientAliveInterval` and `ClientAliveCountMax` control the timeout of ssh sessions. When the `ClientAliveInterval` variable is set, ssh sessions that have no activity for the specified length of time are terminated. When the `ClientAliveCountMax` variable is set, `sshd` will send client alive messages at every `ClientAliveInterval` interval. When the number of consecutive client alive messages are sent with no response from the client, the `ssh` session is terminated. For example, if the `ClientAliveInterval` is set to 15 seconds and the `ClientAliveCountMax` is set to 3, the client `ssh` session will be terminated after 45 seconds of idle time.

## Rationale

Having no timeout value associated with a connection could allow an unauthorized user access to another user's `ssh` session (e.g. user walks away from their computer and doesn't lock the screen). Setting a timeout value at least reduces the risk of this happening.

While the recommended setting is 300 seconds (5 minutes), set this timeout value based on site policy. The recommended setting for `ClientAliveCountMax` is 0. In this case, the client session will be terminated after 5 minutes of idle time and no keepalive messages will be sent.

## Audit Procedure

Run the following commands and verify `ClientAliveInterval` is between 1 and 300 and `ClientAliveCountMax` is 3 or less:

```bash
# sshd -T | grep clientaliveinterval

ClientAliveInterval 300

# sshd -T | grep clientalivecountmax

ClientAliveCountMax 0
```

## Expected Result

- `ClientAliveInterval` is between 1 and 300
- `ClientAliveCountMax` is 3 or less

## Remediation

Edit the `/etc/ssh/sshd_config` file to set the parameters according to site policy:

```
ClientAliveInterval 300
ClientAliveCountMax 0
```

## Default Value

ClientAliveInterval 420
ClientAliveCountMax 3

## CIS Controls

| Controls Version | Control                                                      | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 4.3 Configure Automatic Session Locking on Enterprise Assets | x    | x    | x    |
| v7               | 16.11 Lock Workstation Sessions After Inactivity             | x    | x    | x    |

## Profile

- Level 2 - Server
