---
name: cis-ubuntu1604-v200-3-5-1-6
description: "Ensure ufw firewall rules exist for all open ports"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, firewall]
cis_id: "3.5.1.6"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.5.1.6

## Profile
- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Manual

## Description

Any ports that have been opened on non-loopback addresses need firewall rules to govern traffic.

Notes:
- Changing firewall settings while connected over network can result in being locked out of the system.
- The remediation command opens up the port to traffic from all sources. Consult ufw documentation and set any restrictions in compliance with site policy.

## Rationale

Without a firewall rule configured for open ports default firewall policy will drop all packets to these ports.

## Audit Procedure

### Command Line

Run the following command to determine open ports:

```bash
ss -4tuln
```

Run the following command to determine firewall rules:

```bash
ufw status verbose
```

Verify all open ports listening on non-localhost addresses have at least one firewall rule.

## Remediation

### Command Line

For each port identified in the audit which does not have a firewall rule establish a proper rule for accepting inbound connections:

```bash
ufw allow in <port>/<tcp or udp protocol>
```

## References

None

## CIS Controls

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.
