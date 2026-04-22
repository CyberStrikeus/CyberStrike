---
name: cis-ubuntu1204-v110-9-1-2
description: "Set User/Group Owner and Permission on /etc/crontab"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, authentication, cron, permissions]
cis_id: "9.1.2"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 9.1.2 Set User/Group Owner and Permission on /etc/crontab (Scored)

## Profile Applicability
- Level 1

## Description
The `/etc/crontab` file is used by `cron` to control its own jobs. The commands in this item make sure that root is the user and group owner of the file and that only the owner can access the file.

## Rationale
This file contains information on what system jobs are run by cron. Write access to these files could provide unprivileged users with the ability to elevate their privileges. Read access to these files could provide users with the ability to gain insight on system jobs that run on the system and could provide them a way to gain unauthorized privileged access.

## Audit Procedure
### Using Command Line
Perform the following to determine if the `/etc/crontab` file has the correct permissions:
```bash
stat -c "%a %u %g" /etc/crontab | egrep ".00 0 0"
```

## Expected Result
If the above command emits no output then the system is not configured as recommended. Expected output should match the pattern `.00 0 0` (owner root, group root, permissions restrictive).

## Remediation
### Using Command Line
```bash
chown root:root /etc/crontab
chmod og-rwx /etc/crontab
```

## Default Value
The default permissions on /etc/crontab may vary by installation.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
