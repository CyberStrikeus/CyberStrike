---
name: cis-gcp-cos-5.1.6
description: "Ensure SSH X11 forwarding is disabled"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, ssh, sshd, sshd-config]
cis_id: "5.1.6"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.6 Ensure SSH X11 forwarding is disabled (Automated)

## Description

The X11Forwarding parameter provides the ability to tunnel X11 traffic through the connection to enable remote graphic connections.

## Rationale

Disable X11 forwarding unless there is an operational requirement to use X11 applications directly. There is a small risk that the remote X11 servers of users who are logged in via SSH with X11 forwarding could be compromised by other users on the X11 server. Note that even if X11 forwarding is disabled, users can always install their own forwarders.

## Audit Procedure

Run the following command and verify that output matches:

```bash
# sshd -T | grep x11forwarding

X11Forwarding no
```

## Expected Result

Output should show `X11Forwarding no`.

## Remediation

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
X11Forwarding no
```

## CIS Controls

| Controls Version | Control                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 4.4 Implement and Manage a Firewall on Servers                     | x    | x    | x    |
| v8               | 4.5 Implement and Manage a Firewall on End-User Devices            | x    | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running |      | x    | x    |

## Profile

- Level 1 - Server
