---
name: cis-ubuntu1604-v200-1-7-4
description: "Ensure permissions on /etc/motd are configured"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, motd, permissions, file-permissions, banner]
cis_id: "1.7.4"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.7.4

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The contents of the `/etc/motd` file are displayed to users after login and function as a message of the day for authenticated users.

## Rationale

If the `/etc/motd` file does not have the correct ownership it could be modified by unauthorized users with incorrect or misleading information.

## Audit Procedure

### Command Line

Run the following command and verify `Uid` and `Gid` are both `0/root` and `Access` is `644`, or the file doesn't exist:

```bash
stat /etc/motd
```

Expected output:

```
Access: (0644/-rw-r--r--) Uid: ( 0/ root) Gid: ( 0/ root)
```

OR

```
stat: cannot stat '/etc/motd': No such file or directory
```

## Expected Result

`/etc/motd` should be owned by root:root with permissions 644, or the file should not exist.

## Remediation

### Command Line

Run the following commands to set permissions on `/etc/motd`:

```bash
chown root:root /etc/motd
chmod u-x,go-wx /etc/motd
```

**OR** run the following command to remove the `/etc/motd` file:

```bash
rm /etc/motd
```

## Additional Information

If Message of the day is not needing, this file can be removed.

## Default Value

File doesn't exist.

## References

None.

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 5.1 Establish Secure Configurations |

## Assessment Status

Automated
