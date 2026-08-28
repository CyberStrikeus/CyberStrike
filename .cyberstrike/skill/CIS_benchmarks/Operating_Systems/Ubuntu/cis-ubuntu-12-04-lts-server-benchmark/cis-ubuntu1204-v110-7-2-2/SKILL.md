---
name: cis-ubuntu1204-v110-7-2-2
description: "Disable ICMP Redirect Acceptance"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, networking, icmp, redirects, sysctl, host-router]
cis_id: "7.2.2"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.2.2 Disable ICMP Redirect Acceptance (Scored)

## Profile Applicability

- Level 1

## Description

ICMP redirect messages are packets that convey routing information and tell your host (acting as a router) to send packets via an alternate path. It is a way of allowing an outside routing device to update your system routing tables. By setting `net.ipv4.conf.all.accept_redirects` to 0, the system will not accept any ICMP redirect messages, and therefore, won't allow outsiders to update the system's routing tables.

## Rationale

Attackers could use bogus ICMP redirect messages to maliciously alter the system routing tables and get them to send packets to incorrect networks and allow your system packets to be captured.

## Audit Procedure

### Using Command Line

Perform the following to determine if ICMP redirect messages will be rejected.

```bash
/sbin/sysctl net.ipv4.conf.all.accept_redirects
/sbin/sysctl net.ipv4.conf.default.accept_redirects
```

## Expected Result

```
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
```

## Remediation

### Using Command Line

Set the `net.ipv4.conf.all.accept_redirects` and `net.ipv4.conf.default.accept_redirects` parameters to 0 in `/etc/sysctl.conf`:

```bash
net.ipv4.conf.all.accept_redirects=0
net.ipv4.conf.default.accept_redirects=0
```

Modify active kernel parameters to match:

```bash
/sbin/sysctl -w net.ipv4.conf.all.accept_redirects=0
/sbin/sysctl -w net.ipv4.conf.default.accept_redirects=0
/sbin/sysctl -w net.ipv4.route.flush=1
```

## Default Value

ICMP redirect acceptance is enabled by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
