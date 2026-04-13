---
name: cis-gcp-cos-3.3.3
description: "Ensure iptables is installed"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, firewall, iptables, ip6tables, network-security, package-management]
cis_id: "3.3.3"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.3.3 Ensure iptables is installed (Automated)

## Description

`iptables` allows configuration of the IPv4 and IPv6 tables in the linux kernel and the rules stored within them. Most firewall configuration utilities operate as a front end to `iptables`.

## Rationale

iptables is required for firewall management and configuration.

## Audit Procedure

Run the following command and verify iptables is installed:

```bash
grep '"name": "iptables"' /etc/cos-package-info.json
```

## Expected Result

```
"name": "iptables"
```

## Remediation

Update to an OS image that includes the iptables package.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | **4.4 Implement and Manage a Firewall on Servers** - Implement and manage a firewall on servers, where supported. Example implementations include a virtual firewall, operating system firewall, or a third-party firewall agent. | x | x | x |
| v7 | **9.4 Apply Host-based Firewalls or Port Filtering** - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed. | x | x | x |

## Profile

- Level 1 - Server
