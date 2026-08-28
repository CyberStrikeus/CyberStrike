---
name: cis-ubuntu1204-v110-4-3
description: "Enable Randomized Virtual Memory Region Placement"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, process-hardening, aslr, memory-protection, sysctl]
cis_id: "4.3"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 4.3 Enable Randomized Virtual Memory Region Placement (Scored)

## Profile Applicability

- Level 1

## Description

Set the system flag to force randomized virtual memory region placement.

## Rationale

Randomly placing virtual memory regions will make it difficult to write memory page exploits as the memory placement will be consistently shifting.

## Audit Procedure

### Using Command Line

Perform the following to determine if virtual memory is randomized:

```bash
sysctl kernel.randomize_va_space
```

## Expected Result

The output should be: `kernel.randomize_va_space = 2`

## Remediation

### Using Command Line

Add the following line to the `/etc/sysctl.conf` file:

```
kernel.randomize_va_space = 2
```

## Default Value

By default, `kernel.randomize_va_space` is set to 2 on Ubuntu 12.04.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
