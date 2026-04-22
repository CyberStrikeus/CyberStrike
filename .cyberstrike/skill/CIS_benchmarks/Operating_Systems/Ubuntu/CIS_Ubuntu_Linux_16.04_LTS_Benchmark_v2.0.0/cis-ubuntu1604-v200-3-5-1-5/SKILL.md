---
name: cis-ubuntu1604-v200-3-5-1-5
description: "Ensure ufw outbound connections are configured"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, firewall]
cis_id: "3.5.1.5"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.5.1.5

## Profile
- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Manual

## Description

Configure the firewall rules for new outbound connections.

Notes:
- Changing firewall settings while connected over network can result in being locked out of the system.
- Unlike iptables, when a new outbound rule is added, ufw automatically takes care of associated established connections, so no rules for the latter kind are required.

## Rationale

If rules are not in place for new outbound connections all packets will be dropped by the default policy preventing network usage.

## Audit Procedure

### Command Line

Run the following command and verify all rules for new outbound connections match site policy:

```bash
ufw status numbered
```

## Remediation

### Command Line

Configure ufw in accordance with site policy. The following commands will implement a policy to allow all outbound connections on all interfaces:

```bash
ufw allow out on all
```

## References

None

## CIS Controls

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.
