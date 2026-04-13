---
name: cis-gcp-cos-6.2.16
description: "Ensure no duplicate UIDs exist"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, user-accounts, duplicate-ids]
cis_id: "6.2.16"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.16 Ensure no duplicate UIDs exist (Automated)

## Description

Although the `useradd` program will not let you create a duplicate User ID (UID), it is possible for an administrator to manually edit the `/etc/passwd` file and change the UID field.

## Rationale

Users must be assigned unique UIDs for accountability and to ensure appropriate access protections.

## Audit Procedure

Run the following script and verify no results are returned:

```bash
#!/bin/bash

cut -f3 -d":" /etc/passwd | sort -n | uniq -c | while read x ; do
  [ -z "$x" ] && break
  set - $x
  if [ $1 -gt 1 ]; then
    users=$(awk -F: '($3 == n) { print $1 }' n=$2 /etc/passwd | xargs)
    echo "Duplicate UID ($2): $users"
  fi
done
```

## Expected Result

No results should be returned.

## Remediation

Based on the results of the audit script, establish unique UIDs and review all files owned by the shared UIDs to determine which UID they are supposed to belong to.

## Profile

- Level 1 - Server
