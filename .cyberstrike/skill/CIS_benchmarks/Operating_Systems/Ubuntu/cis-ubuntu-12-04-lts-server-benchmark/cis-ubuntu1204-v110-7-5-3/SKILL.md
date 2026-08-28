---
name: cis-ubuntu1204-v110-7-5-3
description: "Disable RDS"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, networking, rds, kernel-module, attack-surface]
cis_id: "7.5.3"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.5.3 Disable RDS (Not Scored)

## Profile Applicability

- Level 1

## Description

The Reliable Datagram Sockets (RDS) protocol is a transport layer protocol designed to provide low-latency, high-bandwidth communications between cluster nodes. It was developed by the Oracle Corporation.

## Rationale

If the protocol is not being used, it is recommended that kernel module not be loaded, disabling the service to reduce the potential attack surface.

## Audit Procedure

### Using Command Line

Perform the following to determine if RDS is disabled.

```bash
grep "install rds /bin/true" /etc/modprobe.d/CIS.conf
```

## Expected Result

```
install rds /bin/true
```

## Remediation

### Using Command Line

```bash
echo "install rds /bin/true" >> /etc/modprobe.d/CIS.conf
```

## Default Value

RDS kernel module is available by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Not Scored
