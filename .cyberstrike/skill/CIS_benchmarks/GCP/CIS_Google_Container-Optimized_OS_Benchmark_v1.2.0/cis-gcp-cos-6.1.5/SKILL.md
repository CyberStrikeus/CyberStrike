---
name: cis-gcp-cos-6.1.5
description: "Ensure permissions on /etc/passwd- are configured"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, file-permissions, passwd, system-files]
cis_id: "6.1.5"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.1.5 Ensure permissions on /etc/passwd- are configured (Automated)

## Description

The `/etc/passwd-` file contains backup user account information.

## Rationale

It is critical to ensure that the `/etc/passwd-` file is protected from unauthorized access. Although it is protected by default, the file permissions could be changed either inadvertently or through malicious actions.

## Audit Procedure

Run the following command and verify `Uid` and `Gid` are both `0/root` and `Access` is `644` or more restrictive:

```bash
# stat /etc/passwd-
Access: (0644/-rw-r--r--)  Uid: (    0/    root)   Gid: (    0/    root)
```

## Expected Result

`Uid` and `Gid` should both be `0/root` and `Access` should be `644` or more restrictive.

## Remediation

Run the following command to set permissions on `/etc/passwd-`:

```bash
# chown root:root /etc/passwd-

# chmod u-x,go-wx /etc/passwd-
```

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 16.4 Encrypt or Hash all Authentication Credentials | | x | x |

## Profile

- Level 2 - Server
