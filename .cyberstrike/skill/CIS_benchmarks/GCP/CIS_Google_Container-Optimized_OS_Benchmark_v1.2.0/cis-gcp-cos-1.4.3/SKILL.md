---
name: cis-gcp-cos-1.4.3
description: "Ensure address space layout randomization (ASLR) is enabled"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, aslr, process-hardening, exploit-mitigation]
cis_id: "1.4.3"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.4.3 Ensure address space layout randomization (ASLR) is enabled (Automated)

## Description

Address space layout randomization (ASLR) is an exploit mitigation technique which randomly arranges the address space of key data areas of a process.

## Rationale

Randomly placing virtual memory regions will make it difficult to write memory page exploits as the memory placement will be consistently shifting.

## Audit Procedure

Run the following command and verify output matches:

```bash
# sysctl kernel.randomize_va_space
kernel.randomize_va_space = 2

# grep "kernel\.randomize_va_space" /etc/sysctl.conf /etc/sysctl.d/*
kernel.randomize_va_space = 2
```

## Expected Result

`kernel.randomize_va_space = 2` should be the output of both commands.

## Remediation

Set the following parameter in `/etc/sysctl.conf` or a `/etc/sysctl.d/*` file:

```
kernel.randomize_va_space = 2
```

Run the following command to set the active kernel parameter:

```bash
# sysctl -w kernel.randomize_va_space=2
```

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 10.5 Enable Anti-Exploitation Features | | x | x |
| v7 | 8.3 Enable Operating System Anti-Exploitation Features/Deploy Anti-Exploit Technologies | | x | x |

## Profile

Level 1 - Server | Automated
