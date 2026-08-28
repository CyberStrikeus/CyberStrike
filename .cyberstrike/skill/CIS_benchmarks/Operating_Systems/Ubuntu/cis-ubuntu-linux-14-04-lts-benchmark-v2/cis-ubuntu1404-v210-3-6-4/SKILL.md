---
name: "CIS Ubuntu 14.04 LTS - 3.6.4 Ensure outbound and established connections are configured"
description: "Verify that firewall rules for outbound and established connections are configured"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - not-scored
  - firewall
  - network
cis_id: "3.6.4"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 3.6.4 Ensure outbound and established connections are configured (Not Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Configure the firewall rules for new outbound, and established connections.

## Rationale

If rules are not in place for new outbound, and established connections all packets will be dropped by the default policy preventing network usage.

## Audit Procedure

Run the following command and verify all rules for new outbound, and established connections match site policy:

```bash
iptables -L -v -n
```

## Expected Result

Rules should exist that allow new outbound connections and established inbound connections according to site policy.

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

## Default Value

Not configured. Note: Changing firewall settings while connected over network can result in being locked out of the system. Remediation will only affect the active system firewall, be sure to configure the default policy in your firewall management to apply on boot as well.

## References

- CIS Controls: 9.2 - Leverage Host-based Firewalls

## Profile

- Level 1 - Server
- Level 1 - Workstation
