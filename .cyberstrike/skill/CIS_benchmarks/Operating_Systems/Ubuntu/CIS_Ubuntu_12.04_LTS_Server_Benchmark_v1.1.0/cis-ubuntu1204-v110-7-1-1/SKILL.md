---
name: cis-ubuntu1204-v110-7-1-1
description: "Disable IP Forwarding"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, networking, ip-forwarding, sysctl, host-only]
cis_id: "7.1.1"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.1.1 Disable IP Forwarding (Scored)

## Profile Applicability

- Level 1

## Description

The `net.ipv4.ip_forward` flag is used to tell the server whether it can forward packets or not. If the server is not to be used as a router, set the flag to 0.

## Rationale

Setting the flag to 0 ensures that a server with multiple interfaces (for example, a hard proxy), will never be able to forward packets, and therefore, never serve as a router.

## Audit Procedure

### Using Command Line

Perform the following to determine if `net.ipv4.ip_forward` is enabled on the system.

```bash
/sbin/sysctl net.ipv4.ip_forward
```

## Expected Result

```
net.ipv4.ip_forward = 0
```

## Remediation

### Using Command Line

Set the `net.ipv4.ip_forward` parameter to 0 in `/etc/sysctl.conf`:

```bash
net.ipv4.ip_forward=0
```

Modify active kernel parameters to match:

```bash
/sbin/sysctl -w net.ipv4.ip_forward=0
/sbin/sysctl -w net.ipv4.route.flush=1
```

## Default Value

IP forwarding is disabled by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
