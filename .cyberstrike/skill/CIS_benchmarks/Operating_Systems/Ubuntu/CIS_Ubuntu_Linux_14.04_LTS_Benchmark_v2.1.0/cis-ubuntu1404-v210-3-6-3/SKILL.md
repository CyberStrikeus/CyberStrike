---
name: "CIS Ubuntu 14.04 LTS - 3.6.3 Ensure loopback traffic is configured"
description: "Verify that loopback interface accepts traffic and other interfaces deny loopback network traffic"
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
cis_id: "3.6.3"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 3.6.3 Ensure loopback traffic is configured (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Configure the loopback interface to accept traffic. Configure all other interfaces to deny traffic to the loopback network (127.0.0.0/8).

## Rationale

Loopback traffic is generated between processes on machine and is typically critical to operation of the system. The loopback interface is the only place that loopback network (127.0.0.0/8) traffic should be seen, all other interfaces should ignore traffic on this network as an anti-spoofing measure.

## Audit Procedure

Run the following commands and verify output includes the listed rules in order (packet and byte counts may differ):

```bash
iptables -L INPUT -v -n
# Expected:
# Chain INPUT (policy DROP 0 packets, 0 bytes)
# pkts bytes target     prot opt in     out     source               destination
#    0     0 ACCEPT     all  --  lo     *       0.0.0.0/0            0.0.0.0/0
#    0     0 DROP       all  --  *      *       127.0.0.0/8          0.0.0.0/0

iptables -L OUTPUT -v -n
# Expected:
# Chain OUTPUT (policy DROP 0 packets, 0 bytes)
# pkts bytes target     prot opt in     out     source               destination
#    0     0 ACCEPT     all  --  *      lo      0.0.0.0/0            0.0.0.0/0
```

## Expected Result

INPUT chain should accept all traffic on loopback interface and drop traffic from 127.0.0.0/8 on other interfaces. OUTPUT chain should accept all traffic on loopback interface.

## Remediation

Run the following commands to implement the loopback rules:

```bash
iptables -A INPUT -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A INPUT -s 127.0.0.0/8 -j DROP
```

## Default Value

Not configured. Note: Changing firewall settings while connected over network can result in being locked out of the system. Remediation will only affect the active system firewall, be sure to configure the default policy in your firewall management to apply on boot as well.

## References

- CIS Controls: 9.2 - Leverage Host-based Firewalls

## Profile

- Level 1 - Server
- Level 1 - Workstation
