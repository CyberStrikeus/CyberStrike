---
name: cis-ubuntu2004-v300-4-2-3
description: "Ensure iptables-persistent is not installed with ufw"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, ufw]
cis_id: "4.2.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.2.3

## Profile
- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

The `iptables-persistent` is a boot-time loader for netfilter rules, iptables plugin

## Rationale

Running both `ufw` and the services included in the `iptables-persistent` package may lead to conflict

## Audit Procedure

### Command Line

Run the following command to verify that the `iptables-persistent` package is not installed:

```bash
dpkg-query -s iptables-persistent &>/dev/null && echo "iptables-persistent is installed"
```

## Expected Result

Nothing should be returned

## Remediation

### Command Line

Run the following command to remove the `iptables-persistent` package:

```bash
apt purge iptables-persistent
```

## Default Value

Not applicable.

## References

1. NIST SP 800-53 Rev. 5: SC-7

## CIS Controls

v8 - 4.4 Implement and Manage a Firewall on Servers
v8 - 4.5 Implement and Manage a Firewall on End-User Devices
v7 - 9.4 Apply Host-based Firewalls or Port Filtering

MITRE ATT&CK Mappings: T1562, T1562.004 | TA0005 | M1033
