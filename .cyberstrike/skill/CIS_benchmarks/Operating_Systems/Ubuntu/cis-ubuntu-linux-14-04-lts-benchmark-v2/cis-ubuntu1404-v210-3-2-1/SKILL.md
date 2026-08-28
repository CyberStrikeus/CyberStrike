---
name: "CIS Ubuntu 14.04 LTS - 3.2.1 Ensure source routed packets are not accepted"
description: "Verify that source routed packets are not accepted to prevent source routing attacks"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - network
cis_id: "3.2.1"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 3.2.1 Ensure source routed packets are not accepted (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

In networking, source routing allows a sender to partially or fully specify the route packets take through a network. In contrast, non-source routed packets travel a path determined by routers in the network. In some cases, systems may not be routable or reachable from some locations (e.g. private addresses vs. Internet routable), and so source routed packets would need to be used.

## Rationale

Setting `net.ipv4.conf.all.accept_source_route` and `net.ipv4.conf.default.accept_source_route` to 0 disables the system from accepting source routed packets. Assume this system was capable of routing packets to Internet routable addresses on one interface and private addresses on another interface. Assume that the private addresses were not routable to the Internet routable addresses and vice versa. Under normal routing circumstances, an attacker from the Internet routable addresses could not use the system as a way to reach the private address systems. If, however, source routed packets were allowed, they could be used to gain access to the private address systems as the route could be specified, rather than rely on routing protocols that did not allow this routing.

## Audit Procedure

Run the following commands and verify output matches:

```bash
sysctl net.ipv4.conf.all.accept_source_route
# Expected: net.ipv4.conf.all.accept_source_route = 0

sysctl net.ipv4.conf.default.accept_source_route
# Expected: net.ipv4.conf.default.accept_source_route = 0

grep "net\.ipv4\.conf\.all\.accept_source_route" /etc/sysctl.conf /etc/sysctl.d/*
# Expected: net.ipv4.conf.all.accept_source_route= 0

grep "net\.ipv4\.conf\.default\.accept_source_route" /etc/sysctl.conf /etc/sysctl.d/*
# Expected: net.ipv4.conf.default.accept_source_route= 0
```

## Expected Result

```
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
```

## Remediation

Set the following parameters in `/etc/sysctl.conf` or a `/etc/sysctl.d/*` file:

```
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
```

Run the following commands to set the active kernel parameters:

```bash
sysctl -w net.ipv4.conf.all.accept_source_route=0
sysctl -w net.ipv4.conf.default.accept_source_route=0
sysctl -w net.ipv4.route.flush=1
```

## Default Value

Not specified.

## References

- CIS Controls: 3 - Secure Configurations for Hardware and Software on Mobile Devices, Laptops, Workstations, and Servers
- CIS Controls: 11 - Secure Configurations for Network Devices such as Firewalls, Routers and switches

## Profile

- Level 1 - Server
- Level 1 - Workstation
