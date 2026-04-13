---
name: cis-gcp-cos-5.1.8
description: "Ensure SSH IgnoreRhosts is enabled"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, ssh, sshd, sshd-config, authentication]
cis_id: "5.1.8"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.8 Ensure SSH IgnoreRhosts is enabled (Automated)

## Description

The `IgnoreRhosts` parameter specifies that `.rhosts` and `.shosts` files will not be used in `RhostsRSAAuthentication` or `HostbasedAuthentication`.

## Rationale

Setting this parameter forces users to enter a password when authenticating with ssh.

## Audit Procedure

Run the following command and verify that output matches:

```bash
# sshd -T | grep ignorerhosts

IgnoreRhosts yes
```

## Expected Result

Output should show `IgnoreRhosts yes`.

## Remediation

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
IgnoreRhosts yes
```

## Default Value

IgnoreRhosts yes

## CIS Controls

| Controls Version | Control                                                            | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 4.4 Implement and Manage a Firewall on Servers                     | x    | x    | x    |
| v8               | 4.5 Implement and Manage a Firewall on End-User Devices            | x    | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running |      | x    | x    |

## Profile

- Level 1 - Server
