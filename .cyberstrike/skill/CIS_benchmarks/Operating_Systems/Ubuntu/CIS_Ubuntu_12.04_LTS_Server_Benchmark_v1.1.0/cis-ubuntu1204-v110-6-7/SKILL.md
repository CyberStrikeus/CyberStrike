---
name: cis-ubuntu1204-v110-6-7
description: "Ensure NFS and RPC are not enabled"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, nfs, rpc, network-filesystem, attack-surface]
cis_id: "6.7"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.7 Ensure NFS and RPC are not enabled (Not Scored)

## Profile Applicability
- Level 1

## Description
The Network File System (NFS) is one of the first and most widely distributed file systems in the UNIX environment. It provides the ability for systems to mount file systems of other servers through the network.

## Rationale
If the server does not export NFS shares or act as an NFS client, it is recommended that these services be disabled to reduce remote attack surface.

## Audit Procedure
### Using Command Line
Ensure no start conditions listed for `rpcbind-boot`:
```bash
initctl show-config rpcbind-boot rpcbind-boot
```

Run the following to ensure no start links for `nfs-kernel-server` exist in `/etc/rc*.d`:
```bash
ls /etc/rc*.d/S*nfs-kernel-server
```

## Expected Result
No start conditions should be listed for rpcbind-boot and no results should be returned for nfs-kernel-server start links.

## Remediation
### Using Command Line
Remove or comment out start lines in `/etc/init/rpcbind-boot.conf`:
```bash
sed -i 's/^start/#start/' /etc/init/rpcbind-boot.conf
```

Remove any start links for `nfs-kernel-server` from `/etc/rc*.d`:
```bash
rm /etc/rc*.d/S*nfs-kernel-server
```

## Default Value
rpcbind is enabled by default on Ubuntu 12.04 LTS Server. nfs-kernel-server is not installed by default.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Not Scored
