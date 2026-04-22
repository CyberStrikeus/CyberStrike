---
name: cis-ubuntu2004-v300-4-3-3
description: "Ensure iptables are flushed with nftables"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, nftables]
cis_id: "4.3.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.3.3

## Profile

- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Manual

## Description

nftables is a replacement for iptables, ip6tables, ebtables and arptables

## Rationale

It is possible to mix iptables and nftables. However, this increases complexity and also the chance to introduce errors. For simplicity flush out all iptables rules, and ensure it is not loaded

## Audit Procedure

### Command Line

Run the following commands to ensure no iptables rules exist
For iptables:

```bash
iptables -L
```

No rules should be returned
For ip6tables:

```bash
ip6tables -L
```

No rules should be returned

## Expected Result

No rules returned from either command.

## Remediation

### Command Line

Run the following commands to flush iptables:
For iptables:

```bash
iptables -F
```

For ip6tables:

```bash
ip6tables -F
```

## Default Value

Not applicable.

## References

1. NIST SP 800-53 Rev. 5: CA-9, SC-7

## CIS Controls

v8 - 4.4 Implement and Manage a Firewall on Servers
v8 - 4.5 Implement and Manage a Firewall on End-User Devices
v7 - 9.4 Apply Host-based Firewalls or Port Filtering

MITRE ATT&CK Mappings: T1562, T1562.004 | TA0005
