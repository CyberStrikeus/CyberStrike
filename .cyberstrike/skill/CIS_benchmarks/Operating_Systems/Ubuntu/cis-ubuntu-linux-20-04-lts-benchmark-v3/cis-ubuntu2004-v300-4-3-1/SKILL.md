---
name: cis-ubuntu2004-v300-4-3-1
description: "Ensure nftables is installed"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, nftables]
cis_id: "4.3.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.3.1

## Profile

- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

nftables provides a new in-kernel packet classification framework that is based on a network-specific Virtual Machine (VM) and a new nft userspace command line tool. nftables reuses the existing Netfilter subsystems such as the existing hook infrastructure, the connection tracking system, NAT, userspace queuing and logging subsystem.

Notes:

- nftables is available in Linux kernel 3.13 and newer
- Only one firewall utility should be installed and configured
- Changing firewall settings while connected over the network can result in being locked out of the system

## Rationale

nftables is a subsystem of the Linux kernel that can protect against threats originating from within a corporate network to include malicious mobile code and poorly configured software on a host.

## Audit Procedure

### Command Line

Run the following command to verify that `nftables` is installed:

```bash
dpkg-query -s nftables &>/dev/null && echo "nftables is installed"
```

## Expected Result

```
nftables is installed
```

## Remediation

### Command Line

Run the following command to install `nftables`:

```bash
apt install nftables
```

## Default Value

Not applicable.

## References

1. NIST SP 800-53 Rev. 5: CA-9

## CIS Controls

v8 - 4.4 Implement and Manage a Firewall on Servers
v8 - 4.5 Implement and Manage a Firewall on End-User Devices
v7 - 9.4 Apply Host-based Firewalls or Port Filtering

MITRE ATT&CK Mappings: T1562, T1562.004 | TA0011 | M1031, M1037
