---
name: cis-ubuntu1604-v200-3-5-2-1
description: "Ensure nftables is installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, firewall]
cis_id: "3.5.2.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.5.2.1

## Profile

- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

nftables provides a new in-kernel packet classification framework that is based on a network-specific Virtual Machine (VM) and a new nft userspace command line tool. nftables reuses the existing Netfilter subsystems such as the existing hook infrastructure, the connection tracking system, NAT, userspace queuing and logging subsystem.

Notes:

- nftables is available in Linux kernel 3.13 and newer.
- Only one firewall utility should be installed and configured.
- Changing firewall settings while connected over the network can result in being locked out of the system.

## Rationale

nftables is a subsystem of the Linux kernel that can protect against threats originating from within a corporate network to include malicious mobile code and poorly configured software on a host.

## Audit Procedure

### Command Line

Run the following command to verify that nftables is installed:

```bash
dpkg-query -s nftables | grep 'Status: install ok installed'
```

## Expected Result

```
Status: install ok installed
```

## Remediation

### Command Line

Run the following command to install nftables:

```bash
apt install nftables
```

## References

None

## CIS Controls

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.
