---
name: "CIS Ubuntu 14.04 LTS - 3.2.6 Ensure bogus ICMP responses are ignored"
description: "Verify that bogus ICMP error responses are ignored to prevent log file pollution"
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
cis_id: "3.2.6"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 3.2.6 Ensure bogus ICMP responses are ignored (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Setting `icmp_ignore_bogus_error_responses` to 1 prevents the kernel from logging bogus responses (RFC-1122 non-compliant) from broadcast reframes, keeping file systems from filling up with useless log messages.

## Rationale

Some routers (and some attackers) will send responses that violate RFC-1122 and attempt to fill up a log file system with many useless error messages.

## Audit Procedure

Run the following commands and verify output matches:

```bash
sysctl net.ipv4.icmp_ignore_bogus_error_responses
# Expected: net.ipv4.icmp_ignore_bogus_error_responses = 1

grep "net\.ipv4\.icmp_ignore_bogus_error_responses" /etc/sysctl.conf /etc/sysctl.d/*
# Expected: net.ipv4.icmp_ignore_bogus_error_responses = 1
```

## Expected Result

```
net.ipv4.icmp_ignore_bogus_error_responses = 1
```

## Remediation

Set the following parameter in `/etc/sysctl.conf` or a `/etc/sysctl.d/*` file:

```
net.ipv4.icmp_ignore_bogus_error_responses = 1
```

Run the following commands to set the active kernel parameters:

```bash
sysctl -w net.ipv4.icmp_ignore_bogus_error_responses=1
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
