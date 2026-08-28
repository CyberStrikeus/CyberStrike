---
name: cis-ubuntu1604-v200-3-5-1-2
description: "Ensure iptables-persistent is not installed with ufw"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, firewall]
cis_id: "3.5.1.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.5.1.2

## Profile

- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

The iptables-persistent is a boot-time loader for netfilter rules, iptables plugin.

## Rationale

Running both ufw and the services included in the iptables-persistent package may lead to conflict.

## Audit Procedure

### Command Line

Run the following command to verify that the iptables-persistent package is not installed:

```bash
dpkg-query -s iptables-persistent
```

## Expected Result

```
package 'iptables-persistent' is not installed and no information is available
```

## Remediation

### Command Line

Run the following command to remove the iptables-persistent package:

```bash
apt purge iptables-persistent
```

## References

None

## CIS Controls

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.
