---
name: cis-gcp-cos-3.3.1.2
description: "Ensure IPv6 loopback traffic is configured"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, firewall, ip6tables, ipv6, network-security, loopback]
cis_id: "3.3.1.2"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.3.1.2 Ensure IPv6 loopback traffic is configured (Automated)

## Description

Configure the loopback interface to accept traffic. Configure all other interfaces to deny traffic to the loopback network (::1).

## Rationale

Loopback traffic is generated between processes on machine and is typically critical to operation of the system. The loopback interface is the only place that loopback network (::1) traffic should be seen, all other interfaces should ignore traffic on this network as an anti-spoofing measure.

## Impact

Changing firewall settings while connected over network can result in being locked out of the system.

Remediation will only affect the active system firewall, be sure to configure the default policy in your firewall management to apply on boot as well.

## Audit Procedure

Run the following commands and verify output includes the listed rules in order (packet and byte counts may differ):

```bash
ip6tables -L INPUT -v -n
```

```
Chain INPUT (policy DROP 0 packets, 0 bytes)
pkts bytes target     prot opt in     out     source               destination
    0     0 ACCEPT     all      lo     *       ::/0                 ::/0
    0     0 DROP       all      *      *       ::1                  ::/0
```

```bash
ip6tables -L OUTPUT -v -n
```

```
Chain OUTPUT (policy DROP 0 packets, 0 bytes)
pkts bytes target     prot opt in     out     source               destination
    0     0 ACCEPT     all      *      lo      ::/0                 ::/0
```

## Expected Result

- INPUT chain accepts all traffic on loopback interface (`lo`)
- INPUT chain drops all traffic from source `::1`
- OUTPUT chain accepts all traffic on loopback interface (`lo`)

## Remediation

Run the following commands to implement the loopback rules:

```bash
ip6tables -A INPUT -i lo -j ACCEPT
ip6tables -A OUTPUT -o lo -j ACCEPT
ip6tables -A INPUT -s ::1 -j DROP
```

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | **4.4 Implement and Manage a Firewall on Servers** - Implement and manage a firewall on servers, where supported. Example implementations include a virtual firewall, operating system firewall, or a third-party firewall agent. | x | x | x |
| v7 | **9.4 Apply Host-based Firewalls or Port Filtering** - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed. | x | x | x |

## Profile

- Level 2 - Server
