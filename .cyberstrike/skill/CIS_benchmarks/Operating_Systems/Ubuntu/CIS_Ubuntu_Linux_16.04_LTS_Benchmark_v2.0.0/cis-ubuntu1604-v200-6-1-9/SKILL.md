---
name: cis-ubuntu1604-v200-6-1-9
description: "Ensure permissions on /etc/gshadow- are configured"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, file-permissions, maintenance]
cis_id: "6.1.9"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 6.1.9

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `/etc/gshadow-` file is used to store backup information about groups that is critical to the security of those accounts, such as the hashed password and other security information.

## Rationale

It is critical to ensure that the `/etc/gshadow-` file is protected from unauthorized access. Although it is protected by default, the file permissions could be changed either inadvertently or through malicious actions.

## Audit Procedure

### Command Line

Run the following command and verify `Uid` is `0/root`, `Gid` is `0/root` or `<gid>/shadow`, and `Access` is `640` or more restrictive:

```bash
stat /etc/gshadow-
```

## Expected Result

```
Access: (0640/-rw-r-----)  Uid: (    0/    root)   Gid: (   42/  shadow)
```

## Remediation

### Command Line

Run **one** of the following commands to set ownership of `/etc/gshadow-` to `root` and group to either `root` or `shadow`:

```bash
chown root:root /etc/gshadow-
chown root:shadow /etc/gshadow-
```

Run the following command to remove excess permissions from `/etc/gshadow-`:

```bash
chmod u-x,g-wx,o-rwx /etc/gshadow-
```

## Default Value

Access: (0640/-rw-r-----) Uid: ( 0/ root) Gid: ( 42/ shadow)

## References

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0

## CIS Controls

| Controls Version | Control                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| v7               | 16.4 Encrypt or Hash all Authentication Credentials<br>Encrypt or hash with a salt all authentication credentials when stored. |

## Assessment Status

Automated
