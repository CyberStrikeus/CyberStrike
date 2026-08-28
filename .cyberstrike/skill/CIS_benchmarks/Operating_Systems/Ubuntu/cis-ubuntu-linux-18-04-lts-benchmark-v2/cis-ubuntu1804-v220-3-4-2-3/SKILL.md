---
name: cis-ubuntu1804-v220-3-4-2-3
description: "Ensure iptables are flushed with nftables"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, firewall, nftables]
cis_id: "3.4.2.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.4.2.3

## Description

nftables is a replacement for iptables, ip6tables, ebtables and arptables.

## Rationale

It is possible to mix iptables and nftables. However, this increases complexity and is not recommended. Flushing all iptables rules clears the way for a clean nftables configuration.

## Impact

Flushing all iptables rules will remove all firewall rules. Ensure that nftables rules are configured before flushing iptables.

## Audit Procedure

### Command Line

Run the following commands to verify iptables are flushed:

```bash
iptables -L
```

No rules should be returned.

```bash
ip6tables -L
```

No rules should be returned.

## Expected Result

Both commands should return empty chain outputs with no rules:

```
Chain INPUT (policy ACCEPT)
target     prot opt source               destination

Chain FORWARD (policy ACCEPT)
target     prot opt source               destination

Chain OUTPUT (policy ACCEPT)
target     prot opt source               destination
```

## Remediation

### Command Line

Run the following commands to flush iptables:

```bash
iptables -F
ip6tables -F
```

## Default Value

iptables rules are empty by default.

## References

1. NIST SP 800-53 Rev. 5: CA-9, SC-7
2. CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0

## CIS Controls

Version 8

4.4 Implement and Manage a Firewall on Servers - Implement and manage a firewall on servers, where supported.

4.5 Implement and Manage a Firewall on End-User Devices - Implement and manage a host-based firewall or port-filtering tool on end-user devices.

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Manual
