---
name: "CIS Ubuntu 14.04 LTS - 5.1.3 Ensure permissions on /etc/cron.hourly are configured"
description: "Verify /etc/cron.hourly ownership and permissions are restricted to root with no group/other access"
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
cis_id: "5.1.3"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 5.1.3 Ensure permissions on /etc/cron.hourly are configured (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

This directory contains system `cron` jobs that need to run on an hourly basis. The files in this directory cannot be manipulated by the `crontab` command, but are instead edited by system administrators using a text editor. The commands below restrict read/write and search access to user and group root, preventing regular users from accessing this directory.

## Rationale

Granting write access to this directory for non-privileged users could provide them the means for gaining unauthorized elevated privileges. Granting read access to this directory could give an unprivileged user insight in how to gain elevated privileges or circumvent auditing controls.

## Audit Procedure

Run the following command and verify `Uid` and `Gid` are both `0/root` and `Access` does not grant permissions to `group` or `other`:

```bash
stat /etc/cron.hourly
```

## Expected Result

```
Access: (0700/-rw-------)  Uid: (    0/    root)   Gid: (    0/    root)
```

## Remediation

Run the following commands to set ownership and permissions on `/etc/cron.hourly`:

```bash
chown root:root /etc/cron.hourly
chmod og-rwx /etc/cron.hourly
```

## Default Value

Not configured by default.

## References

- CIS Controls: 5.1 - Minimize And Sparingly Use Administrative Privileges

## Profile

- Level 1 - Server
- Level 1 - Workstation
