---
name: cis-ubuntu1804-v220-3-4-3-1-3
description: "Ensure ufw is uninstalled or disabled with iptables"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, firewall, iptables]
cis_id: "3.4.3.1.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.4.3.1.3

## Description

Uncomplicated Firewall (UFW) is a program for managing a netfilter firewall designed to be easy to use.

- Uses a command-line interface consisting of a small number of simple commands
- Uses iptables for configuration

## Rationale

Running `iptables.persistent` with ufw enabled may lead to conflict and unexpected results.

## Impact

None.

## Audit Procedure

### Command Line

Run the following commands to verify that `ufw` is either not installed or disabled. Only one of the following needs to pass.

Run the following command to verify that `ufw` is not installed:

```bash
dpkg-query -s ufw &>/dev/null && echo "ufw is installed"
```

Nothing should be returned.

Run the following command to verify ufw is disabled:

```bash
ufw status
```

Expected output: `Status: inactive`

Run the following commands to verify that the `ufw` service is masked:

```bash
systemctl is-enabled ufw
```

Expected output: `masked`

## Expected Result

ufw is not installed, or `Status: inactive` and `masked`.

## Remediation

### Command Line

Run one of the following commands to either remove ufw or stop and mask ufw:

Run the following command to remove ufw:

```bash
apt purge ufw
```

-OR-

Run the following commands to disable ufw:

```bash
ufw disable
systemctl stop ufw
systemctl mask ufw
```

Note: `ufw disable` needs to be run before `systemctl mask ufw` in order to correctly disable UFW.

## Default Value

ufw is installed and enabled by default.

## References

1. NIST SP 800-53 Rev. 5: SC-7
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
