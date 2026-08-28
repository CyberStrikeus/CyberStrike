---
name: cis-ubuntu2004-v300-4-4-1-3
description: "Ensure ufw is not in use with iptables"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, firewall, iptables]
cis_id: "4.4.1.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0 - Control 4.4.1.3

## Profile

- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Automated

## Description

Uncomplicated Firewall (UFW) is a program for managing a netfilter firewall designed to be easy to use.

- Uses a command-line interface consisting of a small number of simple commands
- Uses iptables for configuration

## Rationale

Running `iptables.persistent` with `ufw` enabled may lead to conflict and unexpected results.

## Audit Procedure

### Command Line

Run the following commands to verify that `ufw` is either not installed or disabled. Only one of the following needs to pass.
Run the following command to verify that `ufw` is not installed:

```bash
dpkg-query -s ufw &>/dev/null && echo "ufw is installed"
```

Nothing should be returned.

- OR -
  Run the following command to verify ufw is disabled:

```bash
ufw status
```

```
Status: inactive
```

Run the following commands to verify that the `ufw.service` is not enabled:

```bash
systemctl is-enabled ufw 2>dev/null | grep '^enabled'
```

Nothing should be returned
Run the following command to verify `ufw.service` is not active:

```bash
systemctl is-active ufw.service 2>/dev/null | grep '^active'
```

Nothing should be returned

## Expected Result

ufw is not installed, or ufw status is inactive and ufw.service is not enabled/active.

## Remediation

### Command Line

Run the following command to remove `ufw`:

```bash
apt purge ufw
```

- OR -
  Run the following commands to disable ufw, and stop and mask `ufw.service`:

```bash
ufw disable
systemctl stop ufw.service
systemctl mask ufw.service
```

Note: `ufw disable` needs to be run before `systemctl mask ufw.service` in order to correctly disable UFW

## Default Value

Not applicable.

## References

1. NIST SP 800-53 Rev. 5: CA-9, CM-7

## CIS Controls

v8 - 4.4 Implement and Manage a Firewall on Servers
v8 - 4.5 Implement and Manage a Firewall on End-User Devices
v7 - 9.4 Apply Host-based Firewalls or Port Filtering

MITRE ATT&CK Mappings: T1562, T1562.004 | TA0011
