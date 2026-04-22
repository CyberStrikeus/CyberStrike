---
name: cis-ubuntu1604-v200-5-1-7
description: "Ensure permissions on /etc/cron.d are configured"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, access-control]
cis_id: "5.1.7"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 5.1.7

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `/etc/cron.d` directory contains system `cron` jobs that need to run in a similar manner to the hourly, daily, weekly and monthly jobs from `/etc/crontab`, but require more granular control as to when they run. The files in this directory cannot be manipulated by the `crontab` command, but are instead edited by system administrators using a text editor. The commands below restrict read/write and search access to user and group root, preventing regular users from accessing this directory.

Note: Other methods, such as `systemd timers`, exist for scheduling jobs. If another method is used, `cron` should be removed, and the alternate method should be secured in accordance with local site policy.

## Rationale

Granting write access to this directory for non-privileged users could provide them the means for gaining unauthorized elevated privileges. Granting read access to this directory could give an unprivileged user insight in how to gain elevated privileges or circumvent auditing controls.

## Impact

None.

## Audit Procedure

### Command Line

Run the following command and verify `Uid` and `Gid` are both `0/root` and `Access` does not grant permissions to `group` or `other`:

```bash
stat /etc/cron.d/
```

## Expected Result

```
Access: (0700/drwx------)  Uid: (    0/    root)  Gid: (    0/    root)
```

## Remediation

### Command Line

Run the following commands to set ownership and permissions on the `/etc/cron.d` directory:

```bash
chown root:root /etc/cron.d/
chmod og-rwx /etc/cron.d/
```

## Default Value

By default, `/etc/cron.d` is owned by root:root with permissions 0755.

## References

None.

## CIS Controls

| Controls Version | Control                                               |
| ---------------- | ----------------------------------------------------- |
| v7               | 14.6 Protect Information through Access Control Lists |

## Assessment Status

Automated
