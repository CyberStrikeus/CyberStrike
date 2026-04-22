---
name: cis-ubuntu1204-v110-7-5-1
description: "Disable DCCP"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, networking, dccp, kernel-module, attack-surface]
cis_id: "7.5.1"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.5.1 Disable DCCP (Not Scored)

## Profile Applicability

- Level 1

## Description

The Datagram Congestion Control Protocol (DCCP) is a transport layer protocol that supports streaming media and telephony. DCCP provides a way to gain access to congestion control, without having to do it at the application layer, but does not provide insequence delivery.

## Rationale

If the protocol is not required, it is recommended that the drivers not be installed to reduce the potential attack surface.

## Audit Procedure

### Using Command Line

Perform the following to determine if DCCP is disabled.

```bash
grep "install dccp /bin/true" /etc/modprobe.d/CIS.conf
```

## Expected Result

```
install dccp /bin/true
```

## Remediation

### Using Command Line

```bash
echo "install dccp /bin/true" >> /etc/modprobe.d/CIS.conf
```

## Default Value

DCCP kernel module is available by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Not Scored
