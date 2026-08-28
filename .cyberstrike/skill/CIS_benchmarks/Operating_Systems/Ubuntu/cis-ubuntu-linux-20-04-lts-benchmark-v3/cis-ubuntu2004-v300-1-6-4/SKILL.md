---
name: cis-ubuntu2004-v300-1-6-4
description: "Ensure access to /etc/motd is configured"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, banners, motd, permissions]
cis_id: "1.6.4"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.6.4 Ensure access to /etc/motd is configured (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The contents of the `/etc/motd` file are displayed to users after login and function as a message of the day for authenticated users.

## Rationale

- IF - the `/etc/motd` file does not have the correct access configured, it could be modified by unauthorized users with incorrect or misleading information.

## Audit Procedure

### Command Line

Run the following command and verify that if `/etc/motd` exists, `Access` is `644` or more restrictive, `Uid` and `Gid` are both `0/root`:

```bash
# [ -e /etc/motd ] && stat -Lc 'Access: (%#a/%A) Uid: ( %u/ %U) Gid: ( %g/ %G)' /etc/motd
```

```
Access: (0644/-rw-r--r--) Uid: ( 0/ root) Gid: ( 0/ root)
  -- OR --
Nothing is returned
```

## Expected Result

Either `Access: (0644/-rw-r--r--) Uid: ( 0/ root) Gid: ( 0/ root)` or nothing returned (file does not exist).

## Remediation

### Command Line

Run the following commands to set mode, owner, and group on `/etc/motd`:

```bash
# chown root:root $(readlink -e /etc/motd)
# chmod u-x,go-wx $(readlink -e /etc/motd)
```

- OR -

Run the following command to remove the `/etc/motd` file:

```bash
# rm /etc/motd
```

## References

1. NIST SP 800-53 Rev. 5: AC-3, MP-2

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | \*   | \*   | \*   |
| v7               | 14.6 Protect Information through Access Control Lists | \*   | \*   | \*   |

MITRE ATT&CK Mappings: T1222, T1222.002 | TA0005 | M1022
