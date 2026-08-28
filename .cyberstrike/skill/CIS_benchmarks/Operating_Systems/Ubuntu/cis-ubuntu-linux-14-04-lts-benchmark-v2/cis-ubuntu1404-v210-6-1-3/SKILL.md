---
name: "CIS Ubuntu 14.04 LTS - 6.1.3 Ensure permissions on /etc/shadow are configured"
description: "Verify /etc/shadow has correct ownership (root:shadow) and permissions (640 or more restrictive)"
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
cis_id: "6.1.3"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "high"
---

# 6.1.3 Ensure permissions on /etc/shadow are configured (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `/etc/shadow` file is used to store the information about user accounts that is critical to the security of those accounts, such as the hashed password and other security information.

## Rationale

If attackers can gain read access to the `/etc/shadow` file, they can easily run a password cracking program against the hashed password to break it. Other security information that is stored in the `/etc/shadow` file (such as expiration) could also be useful to subvert the user accounts.

## Audit Procedure

Run the following command and verify `Uid` is `0/root`, `Gid` is `<gid>/shadow`, and `Access` is `640` or more restrictive:

```bash
stat /etc/shadow
```

## Expected Result

```
Access: (0640/-rw-r-----)  Uid: (    0/    root)   Gid: (   42/  shadow)
```

## Remediation

Run the following commands to set permissions on `/etc/shadow`:

```bash
chown root:shadow /etc/shadow
chmod o-rwx,g-wx /etc/shadow
```

## Default Value

Access: (0640/-rw-r-----) Uid: ( 0/ root) Gid: ( 42/ shadow)

## References

None

## CIS Controls

16.14 Encrypt/Hash All Authentication Files And Monitor Their Access - Verify that all authentication files are encrypted or hashed and that these files cannot be accessed without root or administrator privileges. Audit all access to password files in the system.

## Profile

- Level 1
