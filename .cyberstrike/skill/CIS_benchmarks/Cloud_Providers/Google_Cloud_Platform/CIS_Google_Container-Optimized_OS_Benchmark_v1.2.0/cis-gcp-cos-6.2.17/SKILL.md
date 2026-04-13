---
name: cis-gcp-cos-6.2.17
description: "Ensure no duplicate GIDs exist"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, group-settings, duplicate-ids]
cis_id: "6.2.17"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.17 Ensure no duplicate GIDs exist (Automated)

## Description

Although the `groupadd` program will not let you create a duplicate Group ID (GID), it is possible for an administrator to manually edit the `/etc/group` file and change the GID field.

## Rationale

User groups must be assigned unique GIDs for accountability and to ensure appropriate access protections.

## Audit Procedure

Run the following script and verify no results are returned:

```bash
#!/bin/bash

cut -f3 -d":" /etc/group | sort -n | uniq -c | while read x ; do
  [ -z "$x" ] && break
  set - $x
  if [ $1 -gt 1 ]; then
    groups=$(awk -F: '($3 == n) { print $1 }' n=$2 /etc/group | xargs)
    echo "Duplicate GID ($2): $groups"
  fi
done
```

## Expected Result

No results should be returned.

## Remediation

Based on the results of the audit script, establish unique GIDs and review all files owned by the shared GID to determine which group they are supposed to belong to.

## Additional Information

You can also use the `grpck` command to check for other inconsistencies in the `/etc/group` file.

## Profile

- Level 1 - Server
