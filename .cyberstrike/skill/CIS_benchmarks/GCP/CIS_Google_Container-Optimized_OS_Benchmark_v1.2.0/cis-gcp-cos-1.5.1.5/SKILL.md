---
name: cis-gcp-cos-1.5.1.5
description: "Ensure permissions on /etc/issue are configured"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, banners, login-banner, file-permissions]
cis_id: "1.5.1.5"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.5.1.5 Ensure permissions on /etc/issue are configured (Automated)

## Description

The contents of the `/etc/issue` file are displayed to users prior to login for local terminals.

## Rationale

If the `/etc/issue` file does not have the correct ownership it could be modified by unauthorized users with incorrect or misleading information.

## Audit Procedure

Run the following command and verify `Uid` and `Gid` are both `0/root` and `Access` is `644`:

```bash
# stat /etc/issue
Access: (0644/-rw-r--r--)  Uid: (    0/    root)   Gid: (    0/    root)
```

## Expected Result

The output should show `Access: (0644/-rw-r--r--)`, `Uid: ( 0/ root)`, and `Gid: ( 0/ root)`.

## Remediation

Run the following commands to set permissions on `/etc/issue`:

```bash
# chown root:root /etc/issue
# chmod 644 /etc/issue
```

`/etc` is stateless on Container-Optimized OS. Therefore, the steps mentioned above needs to be performed after every boot.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 5.1 Establish Secure Configurations | x | x | x |

## Profile

Level 1 - Server | Automated
