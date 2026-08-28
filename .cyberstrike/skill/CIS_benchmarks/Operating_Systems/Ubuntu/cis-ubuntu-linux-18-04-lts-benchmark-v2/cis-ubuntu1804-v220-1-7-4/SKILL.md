---
name: cis-ubuntu1804-v220-1-7-4
description: "Ensure permissions on /etc/motd are configured"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, motd, permissions, file-permissions]
cis_id: "1.7.4"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.7.4 Ensure permissions on /etc/motd are configured (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The contents of the `/etc/motd` file are displayed to users after login and function as a message of the day for authenticated users.

## Rationale

If the `/etc/motd` file does not have the correct ownership it could be modified by unauthorized users with incorrect or misleading information.

## Audit Procedure

### Command Line

Run the following command and verify that if `/etc/motd` exists, `Access` is `644` or more restrictive, `Uid` and `Gid` are both `0/root`:

```bash
[ -e /etc/motd ] && stat -Lc 'Access: (%#a/%A) Uid: ( %u/ %U) Gid: ( %g/ %G)' /etc/motd
```

## Expected Result

```
Access: (0644/-rw-r--r--) Uid: ( 0/ root) Gid: ( 0/ root)
  -- OR --
Nothing is returned
```

## Remediation

### Command Line

Run the following commands to set permissions on `/etc/motd`:

```bash
chown root:root $(readlink -e /etc/motd)
chmod u-x,go-wx $(readlink -e /etc/motd)
```

-- OR --

Run the following command to remove the `/etc/motd` file:

```bash
rm /etc/motd
```

## Default Value

File doesn't exist

## Additional Information

If Message of the day is not needed, this file can be removed.

## References

1. NIST SP 800-53 Rev. 5: AC-3, MP-2

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | X    | X    | X    |
| v7               | 14.6 Protect Information through Access Control Lists | X    | X    | X    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1222, T1222.002            | TA0005  | M1022       |
