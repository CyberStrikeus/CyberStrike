---
name: cis-ubuntu1604-v200-6-1-6
description: "Ensure permissions on /etc/shadow are configured"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, file-permissions, maintenance]
cis_id: "6.1.6"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 6.1.6

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `/etc/shadow` file is used to store the information about user accounts that is critical to the security of those accounts, such as the hashed password and other security information.

## Rationale

If attackers can gain read access to the `/etc/shadow` file, they can easily run a password cracking program against the hashed password to break it. Other security information that is stored in the `/etc/shadow` file (such as expiration) could also be useful to subvert the user accounts.

## Audit Procedure

### Command Line

Run the following command and verify `Uid` is `0/root`, `Gid` is `0/root` or `<gid>/shadow`, and `Access` is `640` or more restrictive:

```bash
stat /etc/shadow
```

## Expected Result

```
Access: (0640/-rw-r-----)  Uid: (    0/    root)   Gid: (    0/    root)
```

## Remediation

### Command Line

Run **one** of the following commands to set ownership of `/etc/shadow` to `root` and group to either `root` or `shadow`:

```bash
chown root:root /etc/shadow
chown root:shadow /etc/shadow
```

Run the following command to remove excess permissions from `/etc/shadow`:

```bash
chmod u-x,g-wx,o-rwx /etc/shadow
```

## Default Value

Access: (0640/-rw-r-----) Uid: ( 0/ root) Gid: ( 0/ root)

## References

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0

## CIS Controls

| Controls Version | Control                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| v7               | 16.4 Encrypt or Hash all Authentication Credentials<br>Encrypt or hash with a salt all authentication credentials when stored. |

## Assessment Status

Automated
