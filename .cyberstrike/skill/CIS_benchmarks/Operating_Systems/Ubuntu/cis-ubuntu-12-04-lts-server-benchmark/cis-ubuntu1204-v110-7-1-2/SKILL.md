---
name: cis-ubuntu1204-v110-7-1-2
description: "Disable Send Packet Redirects"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, networking, icmp, redirects, sysctl, host-only]
cis_id: "7.1.2"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.1.2 Disable Send Packet Redirects (Scored)

## Profile Applicability

- Level 1

## Description

ICMP Redirects are used to send routing information to other hosts. As a host itself does not act as a router (in a host only configuration), there is no need to send redirects.

## Rationale

An attacker could use a compromised host to send invalid ICMP redirects to other router devices in an attempt to corrupt routing and have users access a system set up by the attacker as opposed to a valid system.

## Audit Procedure

### Using Command Line

Perform the following to determine if send packet redirects is disabled.

```bash
/sbin/sysctl net.ipv4.conf.all.send_redirects
/sbin/sysctl net.ipv4.conf.default.send_redirects
```

## Expected Result

```
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
```

## Remediation

### Using Command Line

Set the `net.ipv4.conf.all.send_redirects` and `net.ipv4.conf.default.send_redirects` parameters to 0 in `/etc/sysctl.conf`:

```bash
net.ipv4.conf.all.send_redirects=0
net.ipv4.conf.default.send_redirects=0
```

Modify active kernel parameters to match:

```bash
/sbin/sysctl -w net.ipv4.conf.all.send_redirects=0
/sbin/sysctl -w net.ipv4.conf.default.send_redirects=0
/sbin/sysctl -w net.ipv4.route.flush=1
```

## Default Value

Send redirects are enabled by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
