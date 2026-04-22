---
name: cis-ubuntu1804-v220-3-3-8
description: "Ensure source routed packets are not accepted"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, networking, kernel-parameter]
cis_id: "3.3.8"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 3.3.8

## Description

In networking, source routing allows a sender to partially or fully specify the route packets take through the network. In contrast, non-source routed packets travel a path determined by routers in the network. In some cases, systems may not be routable or reachable from some locations (e.g. private addresses vs. internet routable), and so source routed packets would need to be used.

## Rationale

Setting `net.ipv4.conf.all.accept_source_route`, `net.ipv4.conf.default.accept_source_route`, `net.ipv6.conf.all.accept_source_route` and `net.ipv6.conf.default.accept_source_route` to 0 disables the system from accepting source routed packets. Assume this system was capable of routing packets to the internet, an attacker could be redirected through the system to an internal private address using source routed packets.

## Impact

None.

## Audit Procedure

### Command Line

Run the following commands to verify source routed packets are not accepted:

```bash
sysctl net.ipv4.conf.all.accept_source_route
sysctl net.ipv4.conf.default.accept_source_route
sysctl net.ipv6.conf.all.accept_source_route
sysctl net.ipv6.conf.default.accept_source_route
```

## Expected Result

```
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv6.conf.default.accept_source_route = 0
```

## Remediation

### Command Line

Set the following parameters in `/etc/sysctl.conf` or a `/etc/sysctl.d/*` file:

```
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv6.conf.default.accept_source_route = 0
```

Run the following commands to set the active kernel parameters:

```bash
sysctl -w net.ipv4.conf.all.accept_source_route=0
sysctl -w net.ipv4.conf.default.accept_source_route=0
sysctl -w net.ipv6.conf.all.accept_source_route=0
sysctl -w net.ipv6.conf.default.accept_source_route=0
sysctl -w net.ipv4.route.flush=1
sysctl -w net.ipv6.route.flush=1
```

## Default Value

net.ipv4.conf.all.accept_source_route = 0, net.ipv4.conf.default.accept_source_route = 0, net.ipv6.conf.all.accept_source_route = 0, net.ipv6.conf.default.accept_source_route = 0

## References

1. NIST SP 800-53 Rev. 5: CM-7, SC-5, SC-7
2. CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0

## CIS Controls

Version 8

4.1 Establish and Maintain a Secure Configuration Process - Establish and maintain a secure configuration process for enterprise assets.

Version 7

5.1 Establish Secure Configurations - Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
