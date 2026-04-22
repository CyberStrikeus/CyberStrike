---
name: cis-ubuntu1604-v200-3-5-2-9
description: "Ensure nftables service is enabled"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, firewall]
cis_id: "3.5.2.9"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.5.2.9

## Profile

- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

The nftables service allows for the loading of nftables rulesets during boot, or starting on the nftables service.

## Rationale

The nftables service restores the nftables rules from the rules files referenced in the `/etc/nftables.conf` file during boot or the starting of the nftables service.

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

## References

None

## CIS Controls

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.
