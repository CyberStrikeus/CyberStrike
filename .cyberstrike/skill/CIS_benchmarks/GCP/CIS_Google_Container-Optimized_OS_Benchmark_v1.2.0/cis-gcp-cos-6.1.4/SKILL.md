---
name: cis-gcp-cos-6.1.4
description: "Ensure permissions on /etc/gshadow are configured"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, file-permissions, gshadow, system-files]
cis_id: "6.1.4"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.1.4 Ensure permissions on /etc/gshadow are configured (Automated)

## Description

The `/etc/gshadow` file is used to store the information about groups that is critical to the security of those accounts, such as the hashed password and other security information.

## Rationale

If attackers can gain read access to the `/etc/gshadow` file, they can easily run a password cracking program against the hashed password to break it. Other security information that is stored in the `/etc/gshadow` file (such as group administrators) could also be useful to subvert the group.

## Audit Procedure

Run the following command and verify verify `Uid` is `0/root`, `Gid` is `0/root` or `<gid>/shadow`, and `Access` is `640` or more restrictive:

```bash
# stat /etc/gshadow
Access: (0640/-rw-r-----)  Uid: (    0/    root)   Gid: (    0/    root)
```

## Expected Result

`Uid` should be `0/root`, `Gid` should be `0/root` or `<gid>/shadow`, and `Access` should be `640` or more restrictive.

## Remediation

Run the one of the following chown commands as appropriate and the chmod to set permissions on `/etc/gshadow`:

```bash
# chown root:root /etc/gshadow
# chown root:shadow /etc/gshadow

# chmod o-rwx,g-rw /etc/gshadow
```

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 16.4 Encrypt or Hash all Authentication Credentials | | x | x |

## Profile

- Level 1 - Server
