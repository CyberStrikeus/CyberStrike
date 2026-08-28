---
name: cis-ubuntu1804-v220-3-4-1-6
description: "Ensure ufw firewall rules exist for all open ports"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, firewall, ufw]
cis_id: "3.4.1.6"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.4.1.6

## Description

Any ports that have been opened on non-loopback addresses need firewall rules to govern traffic.

## Rationale

Without a firewall rule configured for open ports default firewall policy will drop all packets to these ports.

## Impact

Changing firewall settings while connected over network can result in being locked out of the system.

## Audit Procedure

### Command Line

Run the following command to determine open ports:

```bash
ss -4tuln
```

Run the following command to determine ufw rules:

```bash
ufw status
```

Verify all open ports listening on non-loopback addresses have at least one firewall rule.

## Expected Result

Each port listed by `ss` should have a corresponding `ufw` rule.

## Remediation

### Command Line

For each port identified in the audit which does not have a firewall rule establish a proper rule for accepting inbound connections:

```bash
ufw allow in <port>/<protocol>
```

Example:

```bash
ufw allow in 22/tcp
```

## Default Value

No firewall rules are configured by default.

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
