---
name: cis-ubuntu1204-v110-7-5-4
description: "Disable TIPC"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, networking, tipc, kernel-module, attack-surface]
cis_id: "7.5.4"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.5.4 Disable TIPC (Not Scored)

## Profile Applicability

- Level 1

## Description

The Transparent Inter-Process Communication (TIPC) protocol is designed to provide communication between cluster nodes.

## Rationale

If the protocol is not being used, it is recommended that kernel module not be loaded, disabling the service to reduce the potential attack surface.

## Audit Procedure

### Using Command Line

Perform the following to determine if TIPC is disabled.

```bash
grep "install tipc /bin/true" /etc/modprobe.d/CIS.conf
```

## Expected Result

```
install tipc /bin/true
```

## Remediation

### Using Command Line

```bash
echo "install tipc /bin/true" >> /etc/modprobe.d/CIS.conf
```

## Default Value

TIPC kernel module is available by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Not Scored
