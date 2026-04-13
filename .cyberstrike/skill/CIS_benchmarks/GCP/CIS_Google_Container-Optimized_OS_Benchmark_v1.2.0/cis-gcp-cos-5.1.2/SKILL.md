---
name: cis-gcp-cos-5.1.2
description: "Ensure permissions on SSH private host key files are configured"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, ssh, sshd, permissions, authentication]
cis_id: "5.1.2"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.2 Ensure permissions on SSH private host key files are configured (Automated)

## Description

An SSH private key is one of two files used in SSH public key authentication. In this authentication method, the possession of the private key is proof of identity. Only a private key that corresponds to a public key will be able to authenticate successfully. The private keys need to be stored and handled carefully, and no copies of the private key should be distributed.

## Rationale

If an unauthorized user obtains the private SSH host key file, the host could be impersonated.

## Audit Procedure

Run the following command and verify Uid is 0/root and Gid is 0/root. Ensure group and other do not have permissions:

```bash
# find /etc/ssh -xdev -type f -name 'ssh_host_*_key' -exec stat {} \;

  File: '/etc/ssh/ssh_host_rsa_key'
  Size: 1679       Blocks: 8          IO Block: 4096   regular file
Device: ca01h/51713d    Inode: 8628138     Links: 1
Access: (0600/-rw-------)   Uid: (    0/    root)   Gid: (    0/root)
Access: 2018-10-22 18:24:56.861750616 +0000
Modify: 2018-10-22 18:24:56.861750616 +0000
Change: 2018-10-22 18:24:56.873750616 +0000
 Birth: -
  File: '/etc/ssh/ssh_host_ecdsa_key'
  Size: 227        Blocks: 8          IO Block: 4096   regular file
Device: ca01h/51713d    Inode: 8631760     Links: 1
Access: (0600/-rw-------)   Uid: (    0/    root)   Gid: (    0/root)
Access: 2018-10-22 18:24:56.897750616 +0000
Modify: 2018-10-22 18:24:56.897750616 +0000
Change: 2018-10-22 18:24:56.905750616 +0000
 Birth: -
  File: '/etc/ssh/ssh_host_ed25519_key'
  Size: 387        Blocks: 8          IO Block: 4096   regular file
Device: ca01h/51713d    Inode: 8631762     Links: 1
Access: (0600/-rw-------)   Uid: (    0/    root)   Gid: ( 0/root)
Access: 2018-10-22 18:24:56.945750616 +0000
Modify: 2018-10-22 18:24:56.945750616 +0000
Change: 2018-10-22 18:24:56.957750616 +0000
 Birth: -
```

## Expected Result

- All private host key files have `Uid` of `0/root`
- All private host key files have `Gid` of `0/root`
- Access is `0600/-rw-------` (no permissions for group or other)

## Remediation

Run the following commands to set ownership and permissions on the private SSH host key files:

```bash
# find /etc/ssh -xdev -type f -name 'ssh_host_*_key' -exec chown root:root {} \;
# find /etc/ssh -xdev -type f -name 'ssh_host_*_key' -exec chmod 0600 {} \;
```

## CIS Controls

| Controls Version | Control                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists | x    | x    | x    |
| v7               | 5.1 Establish Secure Configurations     | x    | x    | x    |

## Profile

- Level 1 - Server
