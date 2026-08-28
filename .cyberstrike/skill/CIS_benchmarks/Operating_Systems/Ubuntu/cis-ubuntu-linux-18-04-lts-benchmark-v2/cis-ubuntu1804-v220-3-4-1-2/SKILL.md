---
name: cis-ubuntu1804-v220-3-4-1-2
description: "Ensure iptables-persistent is not installed with ufw"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, firewall, ufw]
cis_id: "3.4.1.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.4.1.2

## Description

The `iptables-persistent` is a boot-time loader for netfilter rules, iptables plugin is used by ufw.

## Rationale

Running both `ufw` and the services included in the `iptables-persistent` package may lead to conflict.

## Impact

None.

## Audit Procedure

### Command Line

Run the following command to verify that the `iptables-persistent` package is not installed:

```bash
dpkg-query -s iptables-persistent &>/dev/null && echo "iptables-persistent is installed"
```

Nothing should be returned.

## Expected Result

No output should be returned (the package is not installed).

## Remediation

### Command Line

Run the following command to remove the `iptables-persistent` package:

```bash
apt purge iptables-persistent
```

## Default Value

iptables-persistent is not installed.

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
