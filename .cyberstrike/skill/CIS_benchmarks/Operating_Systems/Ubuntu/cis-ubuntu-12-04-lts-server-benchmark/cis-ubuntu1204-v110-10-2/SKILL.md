---
name: cis-ubuntu1204-v110-10-2
description: "Disable System Accounts"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, system-accounts, user-management, authentication]
cis_id: "10.2"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.2 Disable System Accounts (Scored)

## Profile Applicability

- Level 1

## Description

There are a number of accounts provided with Ubuntu that are used to manage applications and are not intended to provide an interactive shell.

## Rationale

It is important to make sure that accounts that are not being used by regular users are locked to prevent them from being used to provide an interactive shell. By default Ubuntu set the password field for these accounts to an invalid string, but it is also recommended that the shell field in the password file be set to `/usr/sbin/nologin`. This prevents the account from potentially being used to run any commands.

## Audit Procedure

### Using Command Line

Run the following script to determine if any system accounts can be accessed:

```bash
egrep -v "^\+" /etc/passwd | awk -F: '($1!="root" && $1!="sync" && $1!="shutdown" && $1!="halt" && $3<500 && $7!="/usr/sbin/nologin" && $7!="/bin/false") {print}'
```

## Expected Result

There should be no results returned.

## Remediation

### Using Command Line

Accounts that have been locked are prohibited from running commands on the system. Such accounts are not able to login to the system nor are they able to use scheduled execution facilities such as cron. To make sure system accounts cannot be accessed, using the following script:

```bash
#!/bin/bash
for user in `awk -F: '($3 < 500) {print $1 }' /etc/passwd`; do
  if [ $user != "root" ]; then
    /usr/sbin/usermod -L $user
    if [ $user != "sync" ] && [ $user != "shutdown" ] && [ $user != "halt" ]; then
      /usr/sbin/usermod -s /usr/sbin/nologin $user
    fi
  fi
done
```

## Default Value

System accounts may have interactive shells enabled by default.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
