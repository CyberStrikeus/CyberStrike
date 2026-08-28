---
name: "CIS Ubuntu 14.04 LTS - 5.1.2 Ensure permissions on /etc/crontab are configured"
description: "Verify /etc/crontab ownership and permissions are restricted to root with no group/other access"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - cron
cis_id: "5.1.2"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 5.1.2 Ensure permissions on /etc/crontab are configured (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `/etc/crontab` file is used by `cron` to control its own jobs. The commands in this item make sure that root is the user and group owner of the file and that only the owner can access the file.

## Rationale

This file contains information on what system jobs are run by cron. Write access to these files could provide unprivileged users with the ability to elevate their privileges. Read access to these files could provide users with the ability to gain insight on system jobs that run on the system and could provide them a way to gain unauthorized privileged access.

## Audit Procedure

Run the following command and verify `Uid` and `Gid` are both `0/root` and `Access` does not grant permissions to `group` or `other`:

```bash
stat /etc/crontab
```

## Expected Result

```
Access: (0600/-rw-------)  Uid: (    0/    root)   Gid: (    0/    root)
```

## Remediation

Run the following commands to set ownership and permissions on `/etc/crontab`:

```bash
chown root:root /etc/crontab
chmod og-rwx /etc/crontab
```

## Default Value

Not configured by default.

## References

- CIS Controls: 5.1 - Minimize And Sparingly Use Administrative Privileges

## Profile

- Level 1 - Server
- Level 1 - Workstation
