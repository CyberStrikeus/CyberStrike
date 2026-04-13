---
name: cis-gcp-cos-3.3.2.3
description: "Ensure outbound and established connections are configured"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, firewall, iptables, ipv4, network-security, outbound, established-connections]
cis_id: "3.3.2.3"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.3.2.3 Ensure outbound and established connections are configured (Manual)

## Description

Configure the firewall rules for new outbound, and established connections.

## Rationale

If rules are not in place for new outbound, and established connections all packets will be dropped by the default policy preventing network usage.

## Impact

Changing firewall settings while connected over network can result in being locked out of the system.

Remediation will only affect the active system firewall, be sure to configure the default policy in your firewall management to apply on boot as well.

## Audit Procedure

Run the following command and verify all rules for new outbound, and established connections match site policy:

```bash
iptables -L -v -n
```

## Expected Result

Verify that outbound and established connections are configured in accordance with site policy. The output should show rules allowing NEW and ESTABLISHED outbound connections and ESTABLISHED inbound connections for tcp, udp, and icmp protocols.

## Remediation

Configure iptables in accordance with site policy. The following commands will implement a policy to allow all outbound connections and all established connections:

```bash
iptables -A OUTPUT -p tcp -m state --state NEW,ESTABLISHED -j ACCEPT
iptables -A OUTPUT -p udp -m state --state NEW,ESTABLISHED -j ACCEPT
iptables -A OUTPUT -p icmp -m state --state NEW,ESTABLISHED -j ACCEPT
iptables -A INPUT -p tcp -m state --state ESTABLISHED -j ACCEPT
iptables -A INPUT -p udp -m state --state ESTABLISHED -j ACCEPT
iptables -A INPUT -p icmp -m state --state ESTABLISHED -j ACCEPT
```

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | **4.4 Implement and Manage a Firewall on Servers** - Implement and manage a firewall on servers, where supported. Example implementations include a virtual firewall, operating system firewall, or a third-party firewall agent. | x | x | x |
| v7 | **9.4 Apply Host-based Firewalls or Port Filtering** - Apply host-based firewalls or port filtering tools on end systems, with a default-deny rule that drops all traffic except those services and ports that are explicitly allowed. | x | x | x |

## Profile

- Level 2 - Server
