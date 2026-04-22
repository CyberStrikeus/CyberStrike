---
name: cis-ubuntu1204-v110-11-1
description: "Set Warning Banner for Standard Login Services"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, banner, login, motd, issue]
cis_id: "11.1"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 11.1 Set Warning Banner for Standard Login Services (Scored)

## Profile Applicability
- Level 1

## Description
The contents of the `/etc/issue` file are displayed prior to the login prompt on the system's console and serial devices, and also prior to logins via telnet. The contents of the `/etc/motd` file is generally displayed after all successful logins, no matter where the user is logging in from, but is thought to be less useful because it only provides notification to the user after the machine has been accessed.

## Rationale
Warning messages inform users who are attempting to login to the system of their legal status regarding the system and must include the name of the organization that owns the system and any monitoring policies that are in place. Consult your organization's legal counsel for the appropriate wording for your specific organization.

## Audit Procedure
### Using Command Line
Run the following commands and ensure that the files exist and have the correct permissions:
```bash
/bin/ls -l /etc/motd
# Expected: -rw-r--r-- 1 root root <size> <date> /etc/motd

ls /etc/issue
# Expected: -rw-r--r-- 1 root root <size> <date> /etc/issue

ls /etc/issue.net
# Expected: -rw-r--r-- 1 root root <size> <date> /etc/issue.net
```
Review the contents of these files with the `cat` command and ensure that it is appropriate for your organization.

## Expected Result
All three files (`/etc/motd`, `/etc/issue`, `/etc/issue.net`) exist with permissions `644` and ownership `root:root`, containing an appropriate warning banner.

## Remediation
### Using Command Line
```bash
touch /etc/motd
echo "Authorized uses only. All activity may be \ monitored and reported." > /etc/issue
echo "Authorized uses only. All activity may be \ monitored and reported." > /etc/issue.net
chown root:root /etc/motd
chmod 644 /etc/motd
chown root:root /etc/issue
chmod 644 /etc/issue
chown root:root /etc/issue.net
chmod 644 /etc/issue.net
```

## Default Value
The default contents of these files may contain OS version information.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
