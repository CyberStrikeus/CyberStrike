---
name: cis-ubuntu1604-v200-2-2-6
description: "Ensure RPC is not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.2.6"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.2.6 Ensure RPC is not installed (Automated)

## Description

Remote Procedure Call (RPC) is a method for creating low level client server applications across different system architectures. It requires an RPC compliant client listening on a network port. The supporting package is rpcbind.

## Rationale

If RPC is not required, it is recommended that this services be removed to reduce the remote attack surface.

## Audit Procedure

### Command Line

Run the following command to verify rpcbind is not installed:

```bash
dpkg -s rpcbind | grep -E '(Status:|not installed)'
```

## Expected Result

```
dpkg-query: package 'rpcbind' is not installed and no information is available
```

## Remediation

### Command Line

Run the following command to remove rpcbind:

```bash
apt purge rpcbind
```

## Default Value

rpcbind is not installed on minimal server installations.

## References

1. CIS Controls v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile

- Level 1 - Server
- Level 1 - Workstation
