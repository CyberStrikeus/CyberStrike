---
name: cis-ubuntu1604-v200-6-1-4
description: "Ensure permissions on /etc/group are configured"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, file-permissions, maintenance]
cis_id: "6.1.4"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 6.1.4

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `/etc/group` file contains a list of all the valid groups defined in the system. The command below allows read/write access for root and read access for everyone else.

## Rationale

The `/etc/group` file needs to be protected from unauthorized changes by non-privileged users, but needs to be readable as this information is used with many non-privileged programs.

## Audit Procedure

### Command Line

Run the following command and verify `Uid` and `Gid` are both `0/root` and `Access` is `644`:

```bash
stat /etc/group
```

## Expected Result

```
Access: (0644/-rw-r--r--)  Uid: (    0/    root)   Gid: (    0/    root)
```

## Remediation

### Command Line

Run the following command to set permissions on `/etc/group`:

```bash
chown root:root /etc/group
chmod u-x,go-wx /etc/group
```

## Default Value

Access: (0644/-rw-r--r--) Uid: ( 0/ root) Gid: ( 0/ root)

## References

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0

## CIS Controls

| Controls Version | Control                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| v7               | 16.4 Encrypt or Hash all Authentication Credentials<br>Encrypt or hash with a salt all authentication credentials when stored. |

## Assessment Status

Automated
