---
name: cis-ubuntu1604-v200-3-5-3-2-3
description: "Ensure iptables outbound and established connections are configured"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, firewall]
cis_id: "3.5.3.2.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 3.5.3.2.3

## Profile
- **Level:** Level 1 - Server, Level 1 - Workstation
- **Assessment Status:** Manual

## Description

Configure the firewall rules for new outbound, and established connections.

Notes:
- Changing firewall settings while connected over network can result in being locked out of the system.
- Remediation will only affect the active system firewall, be sure to configure the default policy in your firewall management to apply on boot as well.

## Rationale

If rules are not in place for new outbound, and established connections all packets will be dropped by the default policy preventing network usage.

## Audit Procedure

### Command Line

Run the following command and verify all rules for new outbound, and established connections match site policy:

```bash
iptables -L -v -n
```

## Remediation

### Command Line

Configure iptables in accordance with site policy. The following commands will implement a policy to allow all outbound connections and all established connections:

```bash
iptables -A OUTPUT -p tcp -m state --state NEW,ESTABLISHED -j ACCEPT
iptables -A OUTPUT -p udp -m state --state NEW,ESTABLISHED -j ACCEPT
iptables -A OUTPUT -p icmp -m state --state NEW,ESTABLISHED -j ACCEPT
iptables -A INPUT -p tcp -m state --state ESTABLISHED -j ACCEPT
iptables -A INPUT -p udp -m state --state ESTABLISHED -j ACCEPT
iptables -A INPUT -p icmp -m state --state ESTABLISHED -j ACCEPT
```

## References

None

## CIS Controls

Version 7

9.4 Apply Host-based Firewalls or Port Filtering - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed.
