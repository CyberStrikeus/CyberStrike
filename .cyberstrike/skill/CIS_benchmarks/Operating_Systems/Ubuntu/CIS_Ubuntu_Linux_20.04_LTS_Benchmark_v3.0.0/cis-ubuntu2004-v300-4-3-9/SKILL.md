---
name: cis-ubuntu2004-v300-4-3-9
description: "Ensure nftables service is enabled"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, nftables]
cis_id: "4.3.9"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.3.9

## Profile

- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

The nftables service allows for the loading of nftables rulesets during boot, or starting on the nftables service

## Rationale

The nftables service restores the nftables rules from the rules files referenced in the `/etc/nftables.conf` file during boot or the starting of the nftables service

## Audit Procedure

### Command Line

Run the following command and verify that the nftables service is enabled:

```bash
systemctl is-enabled nftables
```

## Expected Result

```
enabled
```

## Remediation

### Command Line

Run the following command to enable the nftables service:

```bash
systemctl enable nftables
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
