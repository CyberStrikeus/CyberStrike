---
name: "CIS Ubuntu 14.04 LTS - 3.2.7 Ensure Reverse Path Filtering is enabled"
description: "Verify that reverse path filtering is enabled to prevent IP spoofing"
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
cis_id: "3.2.7"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 3.2.7 Ensure Reverse Path Filtering is enabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Setting `net.ipv4.conf.all.rp_filter` and `net.ipv4.conf.default.rp_filter` to 1 forces the Linux kernel to utilize reverse path filtering on a received packet to determine if the packet was valid. Essentially, with reverse path filtering, if the return packet does not go out the same interface that the corresponding source packet came from, the packet is dropped (and logged if `log_martians` is set).

## Rationale

Setting these flags is a good way to deter attackers from sending your system bogus packets that cannot be responded to. One instance where this feature breaks down is if asymmetrical routing is employed. This would occur when using dynamic routing protocols (bgp, ospf, etc) on your system. If you are using asymmetrical routing on your system, you will not be able to enable this feature without breaking the routing.

## Audit Procedure

Run the following commands and verify output matches:

```bash
sysctl net.ipv4.conf.all.rp_filter
# Expected: net.ipv4.conf.all.rp_filter = 1

sysctl net.ipv4.conf.default.rp_filter
# Expected: net.ipv4.conf.default.rp_filter = 1

grep "net\.ipv4\.conf\.all\.rp_filter" /etc/sysctl.conf /etc/sysctl.d/*
# Expected: net.ipv4.conf.all.rp_filter = 1

grep "net\.ipv4\.conf\.default\.rp_filter" /etc/sysctl.conf /etc/sysctl.d/*
# Expected: net.ipv4.conf.default.rp_filter = 1
```

## Expected Result

```
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
```

## Remediation

Set the following parameters in `/etc/sysctl.conf` or a `/etc/sysctl.d/*` file:

```
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
```

Run the following commands to set the active kernel parameters:

```bash
sysctl -w net.ipv4.conf.all.rp_filter=1
sysctl -w net.ipv4.conf.default.rp_filter=1
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
