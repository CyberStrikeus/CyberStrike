---
name: cis-ubuntu1804-v220-3-4-3-1-1
description: "Ensure iptables packages are installed"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, firewall, iptables]
cis_id: "3.4.3.1.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.4.3.1.1

## Description

iptables is a utility program that allows a system administrator to configure the tables provided by the Linux kernel firewall, implemented as different Netfilter modules, and the chains and rules it stores. Different kernel modules and programs are used for different protocols; iptables applies to IPv4, ip6tables to IPv6, arptables to ARP, and ebtables to Ethernet frames.

## Rationale

A method of configuring and maintaining firewall rules is necessary to configure a Host Based Firewall.

## Impact

None.

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

iptables is installed by default. iptables-persistent is not installed by default.

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

Automated
