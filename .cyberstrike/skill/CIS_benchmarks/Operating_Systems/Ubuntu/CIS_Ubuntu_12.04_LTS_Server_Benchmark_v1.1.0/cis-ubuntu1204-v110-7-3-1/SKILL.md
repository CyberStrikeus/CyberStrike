---
name: cis-ubuntu1204-v110-7-3-1
description: "Disable IPv6 Router Advertisements"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, networking, ipv6, router-advertisements, sysctl]
cis_id: "7.3.1"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.3.1 Disable IPv6 Router Advertisements (Not Scored)

## Profile Applicability

- Level 1

## Description

This setting disables the systems ability to accept router advertisements.

## Rationale

It is recommended that systems not accept router advertisements as they could be tricked into routing traffic to compromised machines. Setting hard routes within the system (usually a single default route to a trusted router) protects the system from bad routes.

## Audit Procedure

### Using Command Line

Perform the following to determine if the system is disabled from accepting router advertisements:

```bash
/sbin/sysctl net.ipv6.conf.all.accept_ra
/sbin/sysctl net.ipv6.conf.default.accept_ra
```

## Expected Result

```
net.ipv6.conf.all.accept_ra = 0
net.ipv6.conf.default.accept_ra = 0
```

## Remediation

### Using Command Line

Set the `net.ipv6.conf.all.accept_ra` and `net.ipv6.conf.default.accept_ra` parameter to 0 in `/etc/sysctl.conf`:

```bash
net.ipv6.conf.all.accept_ra=0
net.ipv6.conf.default.accept_ra=0
```

Modify active kernel parameters to match:

```bash
/sbin/sysctl -w net.ipv6.conf.all.accept_ra=0
/sbin/sysctl -w net.ipv6.conf.default.accept_ra=0
/sbin/sysctl -w net.ipv6.route.flush=1
```

## Default Value

IPv6 router advertisements are accepted by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Not Scored
