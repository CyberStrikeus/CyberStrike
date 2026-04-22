---
name: cis-ubuntu1604-v200-2-1-7
description: "Ensure NFS is not installed"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, services]
cis_id: "2.1.7"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.7 Ensure NFS is not installed (Automated)

## Description

The Network File System (NFS) is one of the first and most widely distributed file systems in the UNIX environment. It provides the ability for systems to mount file systems of other servers through the network.

## Rationale

If the system does not export NFS shares or act as an NFS client, it is recommended that these services be removed to reduce the remote attack surface.

## Audit Procedure

### Command Line

Run the following command to verify nfs is not installed:

```bash
dpkg -s nfs-kernel-server | grep -E '(Status:|not installed)'
```

## Expected Result

```
dpkg-query: package 'nfs-kernel-server' is not installed and no information is available
```

## Remediation

### Command Line

Run the following command to remove nfs:

```bash
apt purge nfs-kernel-server
```

## Default Value

nfs-kernel-server is not installed on minimal server installations.

## References

1. CIS Controls v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running

## Profile

- Level 1 - Server
- Level 1 - Workstation
