---
name: cis-ubuntu1604-v200-3-5-3-1-2
description: "Ensure nftables is not installed with iptables"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, firewall]
cis_id: "3.5.3.1.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.5.3.1.2

## Profile

- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

nftables is a subsystem of the Linux kernel providing filtering and classification of network packets/datagrams/frames and is the successor to iptables.

## Rationale

Running both iptables and nftables may lead to conflict.

## Audit Procedure

### Command Line

Run the following command to verify that nftables is not installed:

```bash
dpkg -s nftables
```

## Expected Result

```
dpkg-query: package 'nftables' is not installed
```

## Remediation

### Command Line

Run the following command to remove nftables:

```bash
apt purge nftables
```

## References

None

## CIS Controls

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.
