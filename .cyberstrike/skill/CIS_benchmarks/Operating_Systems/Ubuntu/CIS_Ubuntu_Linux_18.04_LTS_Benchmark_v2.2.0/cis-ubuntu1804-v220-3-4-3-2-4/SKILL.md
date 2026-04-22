---
name: cis-ubuntu1804-v220-3-4-3-2-4
description: "Ensure iptables firewall rules exist for all open ports"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, firewall, iptables]
cis_id: "3.4.3.2.4"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.4.3.2.4

## Description

Any ports that have been opened on non-loopback addresses need firewall rules to govern traffic.

## Rationale

Without a firewall rule configured for open ports default firewall policy will drop all packets to these ports.

## Impact

- Changing firewall settings while connected over network can result in being locked out of the system
- Remediation will only affect the active system firewall, be sure to configure the default policy in your firewall management to apply on boot as well
- The remediation command opens up the port to traffic from all sources. Consult iptables documentation and set any restrictions in compliance with site policy

## Audit Procedure

### Command Line

Run the following command to determine open ports:

```bash
ss -4tuln
```

Run the following command to determine firewall rules:

```bash
iptables -L INPUT -v -n
```

Verify all open ports listening on non-localhost addresses have at least one firewall rule.

## Expected Result

Each open port should have a corresponding iptables rule. For example, a rule for SSH (port 22):

```
0     0 ACCEPT     tcp  --  *      *       0.0.0.0/0            0.0.0.0/0            tcp dpt:22 state NEW
```

## Remediation

### Command Line

For each port identified in the audit which does not have a firewall rule establish a proper rule for accepting inbound connections:

```bash
iptables -A INPUT -p <protocol> --dport <port> -m state --state NEW -j ACCEPT
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
