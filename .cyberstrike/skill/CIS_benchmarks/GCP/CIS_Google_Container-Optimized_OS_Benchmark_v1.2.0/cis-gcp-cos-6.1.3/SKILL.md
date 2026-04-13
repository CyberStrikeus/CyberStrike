---
name: cis-gcp-cos-6.1.3
description: "Ensure permissions on /etc/group are configured"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, file-permissions, group, system-files]
cis_id: "6.1.3"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.1.3 Ensure permissions on /etc/group are configured (Automated)

## Description

The `/etc/group` file contains a list of all the valid groups defined in the system. The command below allows read/write access for root and read access for everyone else.

## Rationale

The `/etc/group` file needs to be protected from unauthorized changes by non-privileged users, but needs to be readable as this information is used with many non-privileged programs.

## Audit Procedure

Run the following command and verify `Uid` and `Gid` are both `0/root` and `Access` is `644`:

```bash
# stat /etc/group
Access: (0644/-rw-r--r--)  Uid: (    0/    root)   Gid: (    0/    root)
```

## Expected Result

`Uid` and `Gid` should both be `0/root` and `Access` should be `644`.

## Remediation

Run the following command to set permissions on `/etc/group`:

```bash
# chown root:root /etc/group
# chmod 644 /etc/group
```

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 16.4 Encrypt or Hash all Authentication Credentials | | x | x |

## Profile

- Level 1 - Server
