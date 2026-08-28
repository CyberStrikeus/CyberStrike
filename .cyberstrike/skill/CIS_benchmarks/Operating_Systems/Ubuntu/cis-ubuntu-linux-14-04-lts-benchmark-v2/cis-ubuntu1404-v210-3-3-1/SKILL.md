---
name: "CIS Ubuntu 14.04 LTS - 3.3.1 Ensure IPv6 router advertisements are not accepted"
description: "Verify that IPv6 router advertisements are not accepted to prevent routing to compromised machines"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - not-scored
  - ipv6
  - network
cis_id: "3.3.1"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 3.3.1 Ensure IPv6 router advertisements are not accepted (Not Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

This setting disables the system's ability to accept IPv6 router advertisements.

## Rationale

It is recommended that systems not accept router advertisements as they could be tricked into routing traffic to compromised machines. Setting hard routes within the system (usually a single default route to a trusted router) protects the system from bad routes.

## Audit Procedure

Run the following commands and verify output matches:

```bash
sysctl net.ipv6.conf.all.accept_ra
# Expected: net.ipv6.conf.all.accept_ra = 0

sysctl net.ipv6.conf.default.accept_ra
# Expected: net.ipv6.conf.default.accept_ra = 0

grep "net\.ipv6\.conf\.all\.accept_ra" /etc/sysctl.conf /etc/sysctl.d/*
# Expected: net.ipv6.conf.all.accept_ra = 0

grep "net\.ipv6\.conf\.default\.accept_ra" /etc/sysctl.conf /etc/sysctl.d/*
# Expected: net.ipv6.conf.default.accept_ra = 0
```

## Expected Result

```
net.ipv6.conf.all.accept_ra = 0
net.ipv6.conf.default.accept_ra = 0
```

## Remediation

Set the following parameters in `/etc/sysctl.conf` or a `/etc/sysctl.d/*` file:

```
net.ipv6.conf.all.accept_ra = 0
net.ipv6.conf.default.accept_ra = 0
```

Run the following commands to set the active kernel parameters:

```bash
sysctl -w net.ipv6.conf.all.accept_ra=0
sysctl -w net.ipv6.conf.default.accept_ra=0
sysctl -w net.ipv6.route.flush=1
```

## Default Value

Not specified.

## References

- CIS Controls: 3 - Secure Configurations for Hardware and Software on Mobile Devices, Laptops, Workstations, and Servers
- CIS Controls: 11 - Secure Configurations for Network Devices such as Firewalls, Routers and switches

## Profile

- Level 1 - Server
- Level 1 - Workstation
