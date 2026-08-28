---
name: cis-ubuntu1804-v220-3-4-1-3
description: "Ensure ufw service is enabled"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, firewall, ufw]
cis_id: "3.4.1.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.4.1.3

## Description

UncomplicatedFirewall (ufw) is a frontend for iptables. ufw provides a framework for managing netfilter, as well as a command-line and available graphical user interface for manipulating the firewall. Ensure that the ufw service is enabled and active.

## Rationale

The ufw service must be enabled and running in order for ufw to protect the system.

## Impact

Changing firewall settings while connected over network can result in being locked out of the system.

## Audit Procedure

### Command Line

Run the following command to verify that the `ufw` daemon is enabled:

```bash
systemctl is-enabled ufw
```

Run the following command to verify that the `ufw` daemon is active:

```bash
systemctl is-active ufw
```

Run the following command to verify `ufw` is active:

```bash
ufw status
```

## Expected Result

```
enabled
active
Status: active
```

## Remediation

### Command Line

Run the following commands to unmask, enable, and start ufw:

```bash
systemctl unmask ufw
systemctl enable ufw
systemctl start ufw
ufw enable
```

## Default Value

ufw is disabled by default.

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
