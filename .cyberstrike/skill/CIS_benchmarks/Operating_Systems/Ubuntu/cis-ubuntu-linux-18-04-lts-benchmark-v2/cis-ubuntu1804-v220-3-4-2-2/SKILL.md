---
name: cis-ubuntu1804-v220-3-4-2-2
description: "Ensure ufw is uninstalled or disabled with nftables"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, firewall, nftables]
cis_id: "3.4.2.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.4.2.2

## Description

Uncomplicated Firewall (ufw) is a frontend for iptables. ufw provides a framework for managing netfilter, as well as a command-line interface for manipulating the firewall.

## Rationale

Running both the nftables service and ufw may lead to conflict.

## Impact

None.

## Audit Procedure

### Command Line

Run the following command to verify that `ufw` is either not installed or disabled. Only one of the following needs to pass:

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

Run the following command to verify that the `ufw` service is masked:

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

## Default Value

ufw is installed and enabled by default.

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
