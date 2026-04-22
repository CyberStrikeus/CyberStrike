---
name: "CIS Ubuntu 14.04 LTS - 2.2.7 Ensure NFS and RPC are not enabled"
description: "Verify that NFS and RPC services are disabled when not required"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - services
cis_id: "2.2.7"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 2.2.7 Ensure NFS and RPC are not enabled (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The Network File System (NFS) is one of the first and most widely distributed file systems in the UNIX environment. It provides the ability for systems to mount file systems of other servers through the network.

## Rationale

If the system does not export NFS shares or act as an NFS client, it is recommended that these services be disabled to reduce remote attack surface.

## Audit Procedure

Run the following to ensure no start links for `nfs-kernel-server` exist in `/etc/rc*.d`:

```bash
ls /etc/rc*.d/S*nfs-kernel-server
```

No results should be returned.

Run the following commands to verify no start conditions listed for `rpcbind`:

```bash
initctl show-config rpcbind
```

Verify the output shows `rpcbind` with no start conditions.

## Expected Result

- No start links should exist for `nfs-kernel-server`.
- The `rpcbind` service should have no start conditions listed.

## Remediation

Remove or comment out start lines in `/etc/init/rpcbind.conf`:

```bash
#start on start-rpcbind
```

Run the following command to disable nfs-kernel-server:

```bash
update-rc.d nfs-kernel-server disable
```

## Default Value

NFS and RPC services are not enabled by default.

## References

- CIS Controls: 9.1 Limit Open Ports, Protocols, and Services

## Profile

- Level 1 - Server
- Level 1 - Workstation
