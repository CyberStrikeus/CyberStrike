---
name: cis-ubuntu1204-v110-7-2-3
description: "Disable Secure ICMP Redirect Acceptance"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, networking, icmp, secure-redirects, sysctl, host-router]
cis_id: "7.2.3"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.2.3 Disable Secure ICMP Redirect Acceptance (Scored)

## Profile Applicability

- Level 1

## Description

Secure ICMP redirects are the same as ICMP redirects, except they come from gateways listed on the default gateway list. It is assumed that these gateways are known to your system, and that they are likely to be secure.

## Rationale

It is still possible for even known gateways to be compromised. Setting `net.ipv4.conf.all.secure_redirects` to 0 protects the system from routing table updates by possibly compromised known gateways.

## Audit Procedure

### Using Command Line

Perform the following to determine if ICMP redirect messages will be rejected from known gateways.

```bash
/sbin/sysctl net.ipv4.conf.all.secure_redirects
/sbin/sysctl net.ipv4.conf.default.secure_redirects
```

## Expected Result

```
net.ipv4.conf.all.secure_redirects = 0
net.ipv4.conf.default.secure_redirects = 0
```

## Remediation

### Using Command Line

Set the `net.ipv4.conf.all.secure_redirects` and `net.ipv4.conf.default.secure_redirects` parameters to 0 in `/etc/sysctl.conf`:

```bash
net.ipv4.conf.all.secure_redirects=0
net.ipv4.conf.default.secure_redirects=0
```

Modify active kernel parameters to match:

```bash
/sbin/sysctl -w net.ipv4.conf.all.secure_redirects=0
/sbin/sysctl -w net.ipv4.conf.default.secure_redirects=0
/sbin/sysctl -w net.ipv4.route.flush=1
```

## Default Value

Secure ICMP redirect acceptance is enabled by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
