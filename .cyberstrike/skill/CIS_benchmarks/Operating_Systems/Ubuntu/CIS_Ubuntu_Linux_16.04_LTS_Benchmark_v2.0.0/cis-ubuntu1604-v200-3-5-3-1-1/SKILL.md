---
name: cis-ubuntu1604-v200-3-5-3-1-1
description: "Ensure iptables packages are installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, firewall]
cis_id: "3.5.3.1.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.5.3.1.1

## Profile
- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

iptables is a utility program that allows a system administrator to configure the tables provided by the Linux kernel firewall, implemented as different Netfilter modules, and the chains and rules it stores. Different kernel modules and programs are used for different protocols; iptables applies to IPv4, ip6tables to IPv6, arptables to ARP, and ebtables to Ethernet frames.

## Rationale

A method of configuring and maintaining firewall rules is necessary to configure a Host Based Firewall.

## Audit Procedure

### Command Line

Run the following command to verify that iptables and iptables-persistent are installed:

```bash
apt list iptables iptables-persistent | grep installed
```

## Expected Result

```
iptables-persistent/<version> [installed,automatic]
iptables/<version> [installed,automatic]
```

## Remediation

### Command Line

Run the following command to install iptables and iptables-persistent:

```bash
apt install iptables iptables-persistent
```

## References

None

## CIS Controls

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.
