---
name: cis-gcp-cos-6.2.18
description: "Ensure no duplicate user names exist"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, user-accounts, duplicate-ids]
cis_id: "6.2.18"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.18 Ensure no duplicate user names exist (Automated)

## Description

Although the `useradd` program will not let you create a duplicate user name, it is possible for an administrator to manually edit the `/etc/passwd` file and change the user name.

## Rationale

If a user is assigned a duplicate user name, it will create and have access to files with the first UID for that username in `/etc/passwd`. For example, if "test4" has a UID of 1000 and a subsequent "test4" entry has a UID of 2000, logging in as "test4" will use UID 1000. Effectively, the UID is shared, which is a security problem.

## Audit Procedure

Run the following script and verify no results are returned:

```bash
#!/bin/bash

cut -f1 -d":" /etc/passwd | sort -n | uniq -c | while read x ; do
  [ -z "$x" ] && break
  set - $x
  if [ $1 -gt 1 ]; then
    uids=$(awk -F: '($1 == n) { print $3 }' n=$2 /etc/passwd | xargs)
    echo "Duplicate User Name ($2): $uids"
  fi
done
```

## Expected Result

No results should be returned.

## Remediation

Based on the results of the audit script, establish unique user names for the users. File ownerships will automatically reflect the change as long as the users have unique UIDs.

## Profile

- Level 1 - Server
