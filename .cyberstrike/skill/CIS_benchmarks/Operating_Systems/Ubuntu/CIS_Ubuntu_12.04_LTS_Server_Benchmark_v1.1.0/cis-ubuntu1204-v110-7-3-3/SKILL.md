---
name: cis-ubuntu1204-v110-7-3-3
description: "Disable IPv6"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, networking, ipv6, disable, sysctl]
cis_id: "7.3.3"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.3.3 Disable IPv6 (Not Scored)

## Profile Applicability

- Level 1

## Description

Although IPv6 has many advantages over IPv4, few organizations have implemented IPv6.

## Rationale

If IPv6 is not to be used, it is recommended that it be disabled to reduce the attack surface of the system.

## Audit Procedure

### Using Command Line

Run the following command to determine if IPv6 is enabled:

```bash
ip addr | grep inet6
```

## Expected Result

No results should be returned.

## Remediation

### Using Command Line

Create or edit the file `/etc/sysctl.conf` and add the following lines:

```bash
net.ipv6.conf.all.disable_ipv6=1
net.ipv6.conf.default.disable_ipv6=1
net.ipv6.conf.lo.disable_ipv6=1
```

Run the following command or reboot to apply the changes:

```bash
sysctl -p
```

## Default Value

IPv6 is enabled by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Not Scored
