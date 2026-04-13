---
name: cis-gcp-cos-3.2.9
description: "Ensure IPv6 router advertisements are not accepted"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, network, sysctl, ipv6, routing]
cis_id: "3.2.9"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.2.9 Ensure IPv6 router advertisements are not accepted (Automated)

## Description

This setting disables the system's ability to accept IPv6 router advertisements.

## Rationale

It is recommended that systems do not accept router advertisements as they could be tricked into routing traffic to compromised machines. Setting hard routes within the system (usually a single default route to a trusted router) protects the system from bad routes.

## Audit Procedure

Run the following commands and verify output matches:

```bash
# sysctl net.ipv6.conf.all.accept_ra
net.ipv6.conf.all.accept_ra = 0
# sysctl net.ipv6.conf.default.accept_ra
net.ipv6.conf.default.accept_ra = 0
```

## Expected Result

Both sysctl commands should return a value of `0`, confirming that IPv6 router advertisements are not accepted.

## Remediation

Run the following commands to set the active kernel parameters:

```bash
# sysctl -w net.ipv6.conf.all.accept_ra=0
# sysctl -w net.ipv6.conf.default.accept_ra=0
# sysctl -w net.ipv6.route.flush=1
```

`/etc` is stateless on Container-Optimized OS. Therefore, `/etc` cannot be used to make these changes persistent across reboots. The steps mentioned above needs to be performed after every boot.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | **12.2 Establish and Maintain a Secure Network Architecture** - Establish and maintain a secure network architecture. A secure network architecture must address segmentation, least privilege, and availability, at a minimum. | | X | X |

## Profile

- Level 2 - Server
