---
name: "CIS Ubuntu 14.04 LTS - 6.1.2 Ensure permissions on /etc/passwd are configured"
description: "Verify /etc/passwd has correct ownership (root:root) and permissions (644)"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - file-permissions
cis_id: "6.1.2"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 6.1.2 Ensure permissions on /etc/passwd are configured (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `/etc/passwd` file contains user account information that is used by many system utilities and therefore must be readable for these utilities to operate.

## Rationale

It is critical to ensure that the `/etc/passwd` file is protected from unauthorized write access. Although it is protected by default, the file permissions could be changed either inadvertently or through malicious actions.

## Audit Procedure

Run the following command and verify `Uid` and `Gid` are both `0/root` and `Access` is `644`:

```bash
stat /etc/passwd
```

## Expected Result

```
Access: (0644/-rw-r--r--)  Uid: (    0/    root)   Gid: (    0/    root)
```

## Remediation

Run the following command to set permissions on `/etc/passwd`:

```bash
chown root:root /etc/passwd
chmod 644 /etc/passwd
```

## Default Value

Access: (0644/-rw-r--r--) Uid: ( 0/ root) Gid: ( 0/ root)

## References

None

## CIS Controls

16.14 Encrypt/Hash All Authentication Files And Monitor Their Access - Verify that all authentication files are encrypted or hashed and that these files cannot be accessed without root or administrator privileges. Audit all access to password files in the system.

## Profile

- Level 1
