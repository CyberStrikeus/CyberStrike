---
name: cis-ubuntu1604-v200-3-5-2-2
description: "Ensure ufw is uninstalled or disabled with nftables"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, firewall]
cis_id: "3.5.2.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.5.2.2

## Profile
- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

Uncomplicated Firewall (UFW) is a program for managing a netfilter firewall designed to be easy to use.

## Rationale

Running both the nftables service and ufw may lead to conflict and unexpected results.

## Audit Procedure

### Command Line

Run the following commands to verify that ufw is either not installed or inactive. Only one of the following needs to pass.

Run the following command to verify that ufw is not installed:

```bash
dpkg-query -s ufw | grep 'Status: install ok installed'
```

Run the following command to verify ufw is disabled:

```bash
ufw status
```

## Expected Result

```
package 'ufw' is not installed and no information is available
```

OR

```
Status: inactive
```

## Remediation

### Command Line

Run one of the following commands to either remove ufw or disable ufw.

Run the following command to remove ufw:

```bash
apt purge ufw
```

Run the following command to disable ufw:

```bash
ufw disable
```

## References

None

## CIS Controls

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.
