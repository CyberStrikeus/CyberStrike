---
name: cis-ubuntu2004-v300-2-1-9
description: "Ensure network file system services are not in use"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, services]
cis_id: "2.1.9"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 2.1.9 Ensure network file system services are not in use (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The Network File System (NFS) is one of the first and most widely distributed file systems in the client/server model. It allows remote hosts to mount file systems over a network and interact with those file systems as though they are mounted locally. If the system does not export NFS shares, it is recommended that the NFS be disabled to reduce the remote attack surface.

## Rationale

If the system does not export NFS shares or act as an NFS server, it is recommended that the nfs-server service be disabled to reduce the remote attack surface.

## Audit Procedure

### Command Line

Run the following command to verify nfs-kernel-server is not installed:

```bash
# dpkg-query -W -f='${binary:Package}\t${Status}\t${db:Status-Status}\n' nfs-kernel-server
```

If installed, run:

```bash
# systemctl is-enabled nfs-server.service
# systemctl is-active nfs-server.service
```

Verify the service is not enabled and not active.

## Expected Result

nfs-kernel-server should not be installed, or if installed, the service should be stopped and masked.

## Remediation

### Command Line

Run the following commands to stop, mask, and purge nfs-kernel-server:

```bash
# systemctl stop nfs-server.service
# systemctl mask nfs-server.service
# apt purge nfs-kernel-server
```

## Default Value

nfs-kernel-server is not installed by default.

## References

1. NIST SP 800-53 Rev. 5: CM-6, CM-7

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              |      | x    | x    |

MITRE ATT&CK Mappings: T1005, T1039, T1083, T1135, T1210 | TA0008 | M1042
