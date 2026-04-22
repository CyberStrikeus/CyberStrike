---
name: cis-ubuntu2004-v300-4-4-1-2
description: "Ensure nftables is not in use with iptables"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, iptables]
cis_id: "4.4.1.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.4.1.2

## Profile
- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

`nftables` is a subsystem of the Linux kernel providing filtering and classification of network packets/datagrams/frames and is the successor to iptables.

## Rationale

Running both `iptables` and `nftables` may lead to conflict.

## Audit Procedure

### Command Line

Run the following commend to verify that `nftables` is not installed:

```bash
dpkg-query -s nftables &>/dev/null && echo "nftables is installed"
```

Nothing should be returned
- OR -
Run the following command to verify `nftables.service` is not enabled:

```bash
systemctl is-enabled nftables.service 2>/dev/null | grep '^enabled'
```

Nothing should be returned
Run the following command to verify `nftables.service` is not active:

```bash
systemctl is-active nftables.service 2>/dev/null | grep '^active'
```

Nothing should be returned

## Expected Result

No output from any of the above commands.

## Remediation

### Command Line

Run the following command to remove `nftables`:

```bash
apt purge nftables
```

- OR -
Run the following commands to stop and mask `nftables.service`:

```bash
systemctl stop nftables.service
systemctl mask nftables.service
```

## Default Value

Not applicable.

## References

1. NIST SP 800-53 Rev. 5: CA-9, CM-7

## CIS Controls

v8 - 4.4 Implement and Manage a Firewall on Servers
v8 - 4.5 Implement and Manage a Firewall on End-User Devices
v7 - 9.4 Apply Host-based Firewalls or Port Filtering

MITRE ATT&CK Mappings: T1562, T1562.004 | TA0011
