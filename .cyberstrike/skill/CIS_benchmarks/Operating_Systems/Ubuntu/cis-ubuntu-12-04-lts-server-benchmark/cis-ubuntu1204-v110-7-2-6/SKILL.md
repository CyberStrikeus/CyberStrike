---
name: cis-ubuntu1204-v110-7-2-6
description: "Enable Bad Error Message Protection"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, networking, icmp, error-messages, sysctl, host-router]
cis_id: "7.2.6"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.2.6 Enable Bad Error Message Protection (Scored)

## Profile Applicability

- Level 1

## Description

Setting `icmp_ignore_bogus_error_responses` to 1 prevents the kernel from logging bogus responses (RFC-1122 non-compliant) from broadcast reframes, keeping file systems from filling up with useless log messages.

## Rationale

Some routers (and some attackers) will send responses that violate RFC-1122 and attempt to fill up a log file system with many useless error messages.

## Audit Procedure

### Using Command Line

Perform the following to determine if bogus messages will be ignored.

```bash
/sbin/sysctl net.ipv4.icmp_ignore_bogus_error_responses
```

## Expected Result

```
net.ipv4.icmp_ignore_bogus_error_responses = 1
```

## Remediation

### Using Command Line

Set the `net.ipv4.icmp_ignore_bogus_error_responses` parameter to 1 in `/etc/sysctl.conf`:

```bash
net.ipv4.icmp_ignore_bogus_error_responses=1
```

Modify active kernel parameters to match:

```bash
/sbin/sysctl -w net.ipv4.icmp_ignore_bogus_error_responses=1
/sbin/sysctl -w net.ipv4.route.flush=1
```

## Default Value

Bogus error message protection is disabled by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
