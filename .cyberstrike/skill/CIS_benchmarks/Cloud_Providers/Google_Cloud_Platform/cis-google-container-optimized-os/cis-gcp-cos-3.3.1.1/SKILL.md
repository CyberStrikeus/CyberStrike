---
name: cis-gcp-cos-3.3.1.1
description: "Ensure IPv6 default deny firewall policy"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, firewall, ip6tables, ipv6, network-security, default-deny]
cis_id: "3.3.1.1"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.3.1.1 Ensure IPv6 default deny firewall policy (Automated)

## Description

A default deny all policy on connections ensures that any unconfigured network usage will be rejected.

## Rationale

With a default accept policy the firewall will accept any packet that is not configured to be denied. It is easier to white list acceptable usage than to black list unacceptable usage.

## Impact

Changing firewall settings while connected over network can result in being locked out of the system.

Remediation will only affect the active system firewall, be sure to configure the default policy in your firewall management to apply on boot as well.

## Audit Procedure

Run the following command and verify that the policy for the INPUT, OUTPUT, and FORWARD chains is DROP or REJECT:

```bash
ip6tables -L
```

## Expected Result

```
Chain INPUT (policy DROP)
Chain FORWARD (policy DROP)
Chain OUTPUT (policy DROP)
```

## Remediation

Run the following commands to implement a default DROP policy:

```bash
ip6tables -P INPUT DROP
ip6tables -P OUTPUT DROP
ip6tables -P FORWARD DROP
```

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | **4.4 Implement and Manage a Firewall on Servers** - Implement and manage a firewall on servers, where supported. Example implementations include a virtual firewall, operating system firewall, or a third-party firewall agent.      | x    | x    | x    |
| v7               | **9.4 Apply Host-based Firewalls or Port Filtering** - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed. | x    | x    | x    |

## Profile

- Level 2 - Server
