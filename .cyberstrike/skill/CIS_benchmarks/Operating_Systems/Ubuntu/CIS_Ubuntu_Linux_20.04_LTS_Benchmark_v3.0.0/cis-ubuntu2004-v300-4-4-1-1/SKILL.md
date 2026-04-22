---
name: cis-ubuntu2004-v300-4-4-1-1
description: "Ensure iptables packages are installed"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, iptables]
cis_id: "4.4.1.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.4.1.1

## Profile
- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

`iptables` is a utility program that allows a system administrator to configure the tables provided by the Linux kernel firewall, implemented as different Netfilter modules, and the chains and rules it stores. Different kernel modules and programs are used for different protocols; `iptables` applies to IPv4, ip6tables to IPv6, arptables to ARP, and ebtables to Ethernet frames.

## Rationale

A method of configuring and maintaining firewall rules is necessary to configure a Host Based Firewall.

## Audit Procedure

### Command Line

Run the following command to verify that `iptables` is installed:

```bash
dpkg-query -s iptables &>/dev/null && echo "iptables is installed"
```

Run the following command to verify that `iptables-persistent` is installed:

```bash
dpkg-query -s iptables-persistent &>/dev/null && echo "iptables-persistent is installed"
```

## Expected Result

```
iptables is installed
iptables-persistent is installed
```

## Remediation

### Command Line

Run the following command to install `iptables` and `iptables-persistent`:

```bash
apt install iptables iptables-persistent
```

## Default Value

Not applicable.

## References

1. NIST SP 800-53 Rev. 5: CA-9, SC-7

## CIS Controls

v8 - 4.4 Implement and Manage a Firewall on Servers
v8 - 4.5 Implement and Manage a Firewall on End-User Devices
v7 - 9.4 Apply Host-based Firewalls or Port Filtering

MITRE ATT&CK Mappings: T1562, T1562.004 | TA0011 | M1031, M1037
