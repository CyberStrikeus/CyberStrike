---
name: cis-ubuntu1604-v200-5-3-2
description: "Ensure permissions on SSH private host key files are configured"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, ssh, remote-access]
cis_id: "5.3.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 5.3.2

## Description

An SSH private key is one of two files used in SSH public key authentication. In this authentication method, The possession of the private key is proof of identity. Only a private key that corresponds to a public key will be able to authenticate successfully. The private keys need to be stored and handled carefully, and no copies of the private key should be distributed.

## Rationale

If an unauthorized user obtains the private SSH host key file, the host could be impersonated.

## Audit Procedure

### Command Line

Run the following command and verify Uid is 0/root and Gid is 0/root and permissions are `0600` or more restrictive:

```bash
find /etc/ssh -xdev -type f -name 'ssh_host_*_key' -exec stat {} \;
```

### Expected Result

```
  File: '/etc/ssh/ssh_host_rsa_key'
  Size: 1675            Blocks: 8          IO Block: 4096   regular file
Access: (0600/-rw-------)  Uid: (    0/    root)  Gid: (    0/    root)
  File: '/etc/ssh/ssh_host_ecdsa_key'
  Size: 227             Blocks: 8          IO Block: 4096   regular file
Access: (0600/-rw-------)  Uid: (    0/    root)  Gid: (    0/    root)
  File: '/etc/ssh/ssh_host_ed25519_key'
  Size: 399             Blocks: 8          IO Block: 4096   regular file
Access: (0600/-rw-------)  Uid: (    0/    root)  Gid: (    0/    root)
  File: '/etc/ssh/ssh_host_dsa_key'
  Size: 672             Blocks: 8          IO Block: 4096   regular file
Access: (0600/-rw-------)  Uid: (    0/    root)  Gid: (    0/    root)
```

## Remediation

### Command Line

Run the following commands to set permissions, ownership, and group on the private SSH host key files:

```bash
find /etc/ssh -xdev -type f -name 'ssh_host_*_key' -exec chown root:root {} \;
find /etc/ssh -xdev -type f -name 'ssh_host_*_key' -exec chmod u-x,go-rwx {} \;
```

## Default Value

Access: (0600/-rw-------) Uid: ( 0/ root) Gid: ( 0/ root)

## References

1. SSHD_CONFIG(5)

## CIS Controls

Version 7

14.6 Protect Information through Access Control Lists - Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
