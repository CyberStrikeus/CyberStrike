---
name: cis-ubuntu1604-v200-5-3-3
description: "Ensure permissions on SSH public host key files are configured"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, ssh, remote-access]
cis_id: "5.3.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 5.3.3

## Description

An SSH public key is one of two files used in SSH public key authentication. In this authentication method, a public key is a key that can be used for verifying digital signatures generated using a corresponding private key. Only a public key that corresponds to a private key will be able to authenticate successfully.

## Rationale

If a public host key file is modified by an unauthorized user, the SSH service may be compromised.

## Audit Procedure

### Command Line

Run the following command and verify Access does not grant write or execute permissions to group or other for all returned files:

```bash
find /etc/ssh -xdev -type f -name 'ssh_host_*_key.pub' -exec stat {} \;
```

### Expected Result

```
  File: '/etc/ssh/ssh_host_rsa_key.pub'
  Size: 382             Blocks: 8          IO Block: 4096   regular file
Access: (0644/-rw-r--r--)  Uid: (    0/    root)  Gid: (    0/    root)
  File: '/etc/ssh/ssh_host_ecdsa_key.pub'
  Size: 162             Blocks: 8          IO Block: 4096   regular file
Access: (0644/-rw-r--r--)  Uid: (    0/    root)  Gid: (    0/    root)
  File: '/etc/ssh/ssh_host_ed25519_key.pub'
  Size: 82              Blocks: 8          IO Block: 4096   regular file
Access: (0644/-rw-r--r--)  Uid: (    0/    root)  Gid: (    0/    root)
```

## Remediation

### Command Line

Run the following commands to set permissions and ownership on the SSH host public key files:

```bash
find /etc/ssh -xdev -type f -name 'ssh_host_*_key.pub' -exec chmod u-x,go-wx {} \;
find /etc/ssh -xdev -type f -name 'ssh_host_*_key.pub' -exec chown root:root {} \;
```

## Default Value

Access: (0644/-rw-r--r--) Uid: ( 0/ root) Gid: ( 0/ root)

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
