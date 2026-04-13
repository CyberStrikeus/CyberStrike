---
name: cis-gcp-cos-3.3.1.4
description: "Ensure IPv6 firewall rules exist for all open ports"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, firewall, ip6tables, ipv6, network-security, open-ports]
cis_id: "3.3.1.4"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.3.1.4 Ensure IPv6 firewall rules exist for all open ports (Manual)

## Description

Any ports that have been opened on non-loopback addresses need firewall rules to govern traffic.

## Rationale

Without a firewall rule configured for open ports default firewall policy will drop all packets to these ports.

## Impact

Changing firewall settings while connected over network can result in being locked out of the system.

Remediation will only affect the active system firewall, be sure to configure the default policy in your firewall management to apply on boot as well.

The remediation command opens up the port to traffic from all sources. Consult iptables documentation and set any restrictions in compliance with site policy.

## Audit Procedure

Run the following command to determine open ports:

```bash
ss -6tuln
```

Example output:

```
Netid  State      Recv-Q Send-Q   Local Address:Port    Peer Address:Port
udp    UNCONN     0      0                  ::1:123                :::*
udp    UNCONN     0      0                  :::123                 :::*
tcp    LISTEN     0      128                :::22                  :::*
tcp    LISTEN     0      20               ::1:25                   :::*
```

Run the following command to determine firewall rules:

```bash
ip6tables -L INPUT -v -n
```

Example output:

```
Chain INPUT (policy DROP 0 packets, 0 bytes)
 pkts bytes target     prot opt in     out     source               destination
    0     0 ACCEPT     all      lo     *       ::/0                 ::/0
    0     0 DROP       all      *      *       ::1                  ::/0
    0     0 ACCEPT     tcp      *      *       ::/0                 ::/0
tcp dpt:22 state NEW
```

Verify all open ports listening on non-localhost addresses have at least one firewall rule. The last line identified by the "tcp dpt:22 state NEW" identifies it as a firewall rule for new connections on tcp port 22.

## Expected Result

All open ports listening on non-localhost addresses should have at least one corresponding firewall rule allowing inbound connections.

## Remediation

For each port identified in the audit which does not have a firewall rule establish a proper rule for accepting inbound connections:

```bash
ip6tables -A INPUT -p <protocol> --dport <port> -m state --state NEW -j ACCEPT
```

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | **4.4 Implement and Manage a Firewall on Servers** - Implement and manage a firewall on servers, where supported. Example implementations include a virtual firewall, operating system firewall, or a third-party firewall agent. | x | x | x |
| v8 | **12.2 Establish and Maintain a Secure Network Architecture** - Establish and maintain a secure network architecture. A secure network architecture must address segmentation, least privilege, and availability, at a minimum. | | x | x |
| v7 | **9.4 Apply Host-based Firewalls or Port Filtering** - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed. | x | x | x |

## Profile

- Level 2 - Server
