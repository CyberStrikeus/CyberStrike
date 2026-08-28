---
name: cis-ubuntu1804-v220-3-4-1-1
description: "Ensure ufw is installed"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, firewall, ufw]
cis_id: "3.4.1.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.4.1.1

## Description

The Uncomplicated Firewall (ufw) is a frontend for iptables and is particularly well-suited for host-based firewalls. ufw provides a framework for managing netfilter, as well as a command-line interface for manipulating the firewall.

## Rationale

A firewall utility is required to configure the Linux kernel's built in netfilter framework and provide protection against unwanted network traffic.

## Impact

None.

## Audit Procedure

### Command Line

Run the following command to verify that Uncomplicated Firewall (UFW) is installed:

```bash
dpkg-query -s ufw | grep 'Status: install ok installed'
```

## Expected Result

```
Status: install ok installed
```

## Remediation

### Command Line

Run the following command to install Uncomplicated Firewall (UFW):

```bash
apt install ufw
```

## Default Value

ufw is installed by default on Ubuntu.

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
