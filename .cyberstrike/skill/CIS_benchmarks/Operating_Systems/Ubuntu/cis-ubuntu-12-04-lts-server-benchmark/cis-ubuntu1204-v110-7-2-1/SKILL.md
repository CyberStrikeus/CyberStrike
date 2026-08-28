---
name: cis-ubuntu1204-v110-7-2-1
description: "Disable Source Routed Packet Acceptance"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, networking, source-routing, sysctl, host-router]
cis_id: "7.2.1"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.2.1 Disable Source Routed Packet Acceptance (Scored)

## Profile Applicability

- Level 1

## Description

In networking, source routing allows a sender to partially or fully specify the route packets take through a network. In contrast, non-source routed packets travel a path determined by routers in the network. In some cases, systems may not be routable or reachable from some locations (e.g. private addresses vs. Internet routable), and so source routed packets would need to be used.

## Rationale

Setting `net.ipv4.conf.all.accept_source_route` and `net.ipv4.conf.default.accept_source_route` to 0 disables the system from accepting source routed packets. Assume this server was capable of routing packets to Internet routable addresses on one interface and private addresses on another interface. Assume that the private addresses were not routable to the Internet routable addresses and vice versa. Under normal routing circumstances, an attacker from the Internet routable addresses could not use the server as a way to reach the private address servers. If, however, source routed packets were allowed, they could be used to gain access to the private address systems as the route could be specified, rather than rely on routing protocols that did not allow this routing.

## Audit Procedure

### Using Command Line

Perform the following to determine if accepting source routed packets is disabled.

```bash
/sbin/sysctl net.ipv4.conf.all.accept_source_route
/sbin/sysctl net.ipv4.conf.default.accept_source_route
```

## Expected Result

```
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
```

## Remediation

### Using Command Line

Set the `net.ipv4.conf.all.accept_source_route` and `net.ipv4.conf.default.accept_source_route` parameters to 0 in `/etc/sysctl.conf`:

```bash
net.ipv4.conf.all.accept_source_route=0
net.ipv4.conf.default.accept_source_route=0
```

Modify active kernel parameters to match:

```bash
/sbin/sysctl -w net.ipv4.conf.all.accept_source_route=0
/sbin/sysctl -w net.ipv4.conf.default.accept_source_route=0
/sbin/sysctl -w net.ipv4.route.flush=1
```

## Default Value

Source routed packet acceptance is enabled by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
