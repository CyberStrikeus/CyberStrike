---
name: cis-ubuntu1204-v110-13-1
description: "Ensure Password Fields are Not Empty"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, user-management, password, shadow, authentication]
cis_id: "13.1"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 13.1 Ensure Password Fields are Not Empty (Scored)

## Profile Applicability
- Level 1

## Description
An account with an empty password field means that anybody may log in as that user without providing a password.

## Rationale
All accounts must have passwords or be locked to prevent the account from being used by an unauthorized user.

## Audit Procedure
### Using Command Line
Run the following command and verify that no output is returned:
```bash
/bin/cat /etc/shadow | /usr/bin/awk -F: '($2 == "" ) { print $1 " does not have a password "}'
```

## Expected Result
No output should be returned. If any accounts are listed, they have empty password fields.

## Remediation
### Using Command Line
If any accounts in the `/etc/shadow` file do not have a password, run the following command to lock the account until it can be determined why it does not have a password:
```bash
/usr/bin/passwd -l <username>
```
Also, check to see if the account is logged in and investigate what it is being used for to determine if it needs to be forced off.

## Default Value
By default, all accounts created with `useradd` or `adduser` require a password to be set.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
