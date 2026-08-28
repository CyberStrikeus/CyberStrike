---
name: cis-ubuntu1204-v110-9-1-8
description: "Restrict at/cron to Authorized Users"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, authentication, cron, at, access-control]
cis_id: "9.1.8"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 9.1.8 Restrict at/cron to Authorized Users (Scored)

## Profile Applicability

- Level 1

## Description

Configure `/etc/cron.allow` and `/etc/at.allow` to allow specific users to use these services. If `/etc/cron.allow` or `/etc/at.allow` do not exist, then `/etc/at.deny` and `/etc/cron.deny` are checked. Any user not specifically defined in those files is allowed to use at and cron. By removing the files, only users in `/etc/cron.allow` and `/etc/at.allow` are allowed to use at and cron. Note that even though a given user is not listed in `cron.allow`, cron jobs can still be run as that user. The `cron.allow` file only controls administrative access to the crontab command for scheduling and modifying cron jobs.

## Rationale

On many systems, only the system administrator is authorized to schedule `cron` jobs. Using the `cron.allow` file to control who can run `cron` jobs enforces this policy. It is easier to manage an allow list than a deny list. In a deny list, you could potentially add a user ID to the system and forget to add it to the deny files.

## Audit Procedure

### Using Command Line

Perform the following to determine if the remediation in the section has been performed:

```bash
ls -l /etc/cron.deny
ls -l /etc/at.deny
ls -l /etc/cron.allow
ls -l /etc/at.allow
```

## Expected Result

```
/etc/cron.deny - [no output returned / file should not exist]
/etc/at.deny - [no output returned / file should not exist]
/etc/cron.allow - -rw------- 1 root root /etc/cron.allow
/etc/at.allow - -rw------- 1 root root /etc/at.allow
```

## Remediation

### Using Command Line

```bash
/bin/rm /etc/cron.deny
/bin/rm /etc/at.deny
touch /etc/cron.allow
touch /etc/at.allow
chmod og-rwx /etc/cron.allow
chmod og-rwx /etc/at.allow
chown root:root /etc/cron.allow
chown root:root /etc/at.allow
```

## Default Value

By default, /etc/cron.deny and /etc/at.deny exist; /etc/cron.allow and /etc/at.allow do not.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
