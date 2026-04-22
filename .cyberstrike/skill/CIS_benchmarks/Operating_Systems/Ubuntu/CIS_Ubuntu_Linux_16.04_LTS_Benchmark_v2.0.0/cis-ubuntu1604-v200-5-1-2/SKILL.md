---
name: cis-ubuntu1604-v200-5-1-2
description: "Ensure permissions on /etc/crontab are configured"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, access-control]
cis_id: "5.1.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 5.1.2

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `/etc/crontab` file is used by `cron` to control its own jobs. The commands in this item make sure that root is the user and group owner of the file and that only the owner can access the file.

Note: Other methods, such as `systemd timers`, exist for scheduling jobs. If another method is used, `cron` should be removed, and the alternate method should be secured in accordance with local site policy.

## Rationale

This file contains information on what system jobs are run by cron. Write access to these files could provide unprivileged users with the ability to elevate their privileges. Read access to these files could provide users with the ability to gain insight on system jobs that run on the system and could provide them a way to gain unauthorized privileged access.

## Impact

None.

## Audit Procedure

### Command Line

Run the following command and verify `Uid` and `Gid` are both `0/root` and `Access` does not grant permissions to `group` or `other`:

```bash
stat /etc/crontab
```

## Expected Result

```
Access: (0600/-rw-------)  Uid: (    0/    root)  Gid: (    0/    root)
```

## Remediation

### Command Line

Run the following commands to set ownership and permissions on `/etc/crontab`:

```bash
chown root:root /etc/crontab
chmod og-rwx /etc/crontab
```

## Default Value

By default, `/etc/crontab` is owned by root:root with permissions 0644.

## References

None.

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 14.6 Protect Information through Access Control Lists |

## Assessment Status

Automated
