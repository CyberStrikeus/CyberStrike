---
name: cis-ubuntu1204-v110-7-7
description: "Ensure Firewall is active"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, networking, firewall, iptables, ufw]
cis_id: "7.7"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.7 Ensure Firewall is active (Scored)

## Profile Applicability

- Level 1

## Description

IPtables is an application that allows a system administrator to configure the IPv4 tables, chains and rules provided by the Linux kernel firewall. `ufw` was developed to ease IPtables firewall configuration.

## Rationale

IPtables provides extra protection for the Linux system by limiting communications in and out of the box to specific IPv4 addresses and ports. Ubuntu provides UFW to ease firewall configuration.

## Audit Procedure

### Using Command Line

Ensure `ufw` is active:

```bash
ufw status
```

## Expected Result

```
Status: active
```

## Remediation

### Using Command Line

Activate `ufw`:

```bash
ufw enable
```

Ensure that any needed ports, such as ssh access, are configured properly first.

## Default Value

UFW is inactive by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
