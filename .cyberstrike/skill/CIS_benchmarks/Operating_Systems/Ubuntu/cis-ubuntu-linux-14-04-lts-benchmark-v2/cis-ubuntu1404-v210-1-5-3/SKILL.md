---
name: "CIS Ubuntu 14.04 LTS - 1.5.3 Ensure address space layout randomization (ASLR) is enabled"
description: "Verify that ASLR is enabled to randomize process memory layout and mitigate exploits"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - hardening
cis_id: "1.5.3"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 1.5.3 Ensure address space layout randomization (ASLR) is enabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Address space layout randomization (ASLR) is an exploit mitigation technique which randomly arranges the address space of key data areas of a process.

## Rationale

Randomly placing virtual memory regions will make it difficult to write memory page exploits as the memory placement will be consistently shifting.

## Audit Procedure

Run the following command and verify output matches:

```bash
sysctl kernel.randomize_va_space
# Expected: kernel.randomize_va_space = 2
grep "kernel\.randomize_va_space" /etc/sysctl.conf /etc/sysctl.d/*
# Expected: kernel.randomize_va_space = 2
```

## Expected Result

```
kernel.randomize_va_space = 2
kernel.randomize_va_space = 2
```

## Remediation

Set the following parameter in `/etc/sysctl.conf` or a `/etc/sysctl.d/*` file:

```
kernel.randomize_va_space = 2
```

Run the following command to set the active kernel parameter:

```bash
sysctl -w kernel.randomize_va_space=2
```

## Default Value

`kernel.randomize_va_space = 2`

## References

- CIS Controls: 8.4 Enable Anti-exploitation Features (i.e. DEP, ASLR, EMET)

## Profile

- Level 1 - Server
- Level 1 - Workstation
