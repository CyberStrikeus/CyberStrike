---
name: cis-gcp-cos-6.1.6
description: "Ensure permissions on /etc/shadow- are configured"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, file-permissions, shadow, system-files]
cis_id: "6.1.6"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.1.6 Ensure permissions on /etc/shadow- are configured (Automated)

## Description

The `/etc/shadow-` file is used to store backup information about user accounts that is critical to the security of those accounts, such as the hashed password and other security information.

## Rationale

It is critical to ensure that the `/etc/shadow-` file is protected from unauthorized access. Although it is protected by default, the file permissions could be changed either inadvertently or through malicious actions.

## Audit Procedure

Run the following command and verify verify `Uid` is `0/root`, `Gid` is `0/root` or `<gid>/shadow`, and `Access` is `640` or more restrictive:

```bash
# stat /etc/shadow-
Access: (0640/-rw-r-----)  Uid: (    0/    root)   Gid: (    0/    root)
```

## Expected Result

`Uid` should be `0/root`, `Gid` should be `0/root` or `<gid>/shadow`, and `Access` should be `640` or more restrictive.

## Remediation

Run the one of the following chown commands as appropriate and the chmod to set permissions on `/etc/shadow-`:

```bash
# chown root:root /etc/shadow-
# chown root:shadow /etc/shadow-

# chmod o-rwx,g-rw /etc/shadow-
```

## CIS Controls

| Controls Version | Control                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists             | x    | x    | x    |
| v7               | 16.4 Encrypt or Hash all Authentication Credentials |      | x    | x    |

## Profile

- Level 2 - Server
