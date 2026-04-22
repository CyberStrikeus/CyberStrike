---
name: "CIS Ubuntu 14.04 LTS - 3.6.5 Ensure firewall rules exist for all open ports"
description: "Verify that firewall rules exist for all open ports on non-loopback addresses"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - firewall
  - network
cis_id: "3.6.5"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 3.6.5 Ensure firewall rules exist for all open ports (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Any ports that have been opened on non-loopback addresses need firewall rules to govern traffic.

## Rationale

Without a firewall rule configured for open ports default firewall policy will drop all packets to these ports.

## Audit Procedure

Run the following command to determine open ports:

```bash
netstat -ln
# Example output:
# Active Internet connections (only servers)
# Proto Recv-Q Send-Q Local Address           Foreign Address         State
# tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN
```

Run the following command to determine firewall rules:

```bash
iptables -L INPUT -v -n
# Example output:
# Chain INPUT (policy DROP 0 packets, 0 bytes)
#  pkts bytes target     prot opt in     out     source               destination
#     0     0 ACCEPT     all  --  lo     *       0.0.0.0/0            0.0.0.0/0
#     0     0 DROP       all  --  *      *       127.0.0.0/8          0.0.0.0/0
#     0     0 ACCEPT     tcp  --  *      *       0.0.0.0/0            0.0.0.0/0
# tcp dpt:22 state NEW
```

Verify all open ports listening on non-localhost addresses have at least one firewall rule.

## Expected Result

All open ports listening on non-localhost addresses should have at least one corresponding firewall rule.

## Remediation

For each port identified in the audit which does not have a firewall rule establish a proper rule for accepting inbound connections:

```bash
iptables -A INPUT -p <protocol> --dport <port> -m state --state NEW -j ACCEPT
```

## Default Value

Not configured. Note: Changing firewall settings while connected over network can result in being locked out of the system. Remediation will only affect the active system firewall, be sure to configure the default policy in your firewall management to apply on boot as well. The remediation command opens up the port to traffic from all sources. Consult iptables documentation and set any restrictions in compliance with site policy.

## References

- CIS Controls: 9.1 - Limit Open Ports, Protocols, and Services
- CIS Controls: 9.2 - Leverage Host-based Firewalls

## Profile

- Level 1 - Server
- Level 1 - Workstation
