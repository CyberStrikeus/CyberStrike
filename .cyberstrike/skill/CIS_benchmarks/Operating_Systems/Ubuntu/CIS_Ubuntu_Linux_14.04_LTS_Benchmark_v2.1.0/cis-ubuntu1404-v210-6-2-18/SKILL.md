---
name: "CIS Ubuntu 14.04 LTS - 6.2.18 Ensure no duplicate user names exist"
description: "Verify no duplicate user names exist in /etc/passwd"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - user-accounts
cis_id: "6.2.18"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 6.2.18 Ensure no duplicate user names exist (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Although the `useradd` program will not let you create a duplicate user name, it is possible for an administrator to manually edit the `/etc/passwd` file and change the user name.

## Rationale

If a user is assigned a duplicate user name, it will create and have access to files with the first UID for that username in `/etc/passwd`. For example, if "test4" has a UID of 1000 and a subsequent "test4" entry has a UID of 2000, logging in as "test4" will use UID 1000. Effectively, the UID is shared, which is a security problem.

## Audit Procedure

Run the following script and verify no results are returned:

```bash
#!/bin/bash

cat /etc/passwd | cut -f1 -d":" | sort -n | uniq -c | while read x ; do
  [ -z "${x}" ] && break
  set - $x
  if [ $1 -gt 1 ]; then
    uids=`awk -F: '($1 == n) { print $3 }' n=$2 /etc/passwd | xargs`
    echo "Duplicate User Name ($2): ${uids}"
  fi
done
```

## Expected Result

No output should be returned.

## Remediation

Based on the results of the audit script, establish unique user names for the users. File ownerships will automatically reflect the change as long as the users have unique UIDs.

## Default Value

Not applicable.

## References

None

## CIS Controls

16 Account Monitoring and Control - Account Monitoring and Control

## Profile

- Level 1
