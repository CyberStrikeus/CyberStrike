---
name: cis-gcp-cos-6.2.19
description: "Ensure no duplicate group names exist"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, group-settings, duplicate-ids]
cis_id: "6.2.19"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.19 Ensure no duplicate group names exist (Automated)

## Description

Although the `groupadd` program will not let you create a duplicate group name, it is possible for an administrator to manually edit the `/etc/group` file and change the group name.

## Rationale

If a group is assigned a duplicate group name, it will create and have access to files with the first GID for that group in `/etc/group`. Effectively, the GID is shared, which is a security problem.

## Audit Procedure

Run the following script and verify no results are returned:

```bash
#!/bin/bash

cut -f1 -d":" /etc/group | sort -n | uniq -c | while read x ; do
  [ -z "$x" ] && break
  set - $x
  if [ $1 -gt 1 ]; then
    gids=$(gawk -F: '($1 == n) { print $3 }' n=$2 /etc/group | xargs)
    echo "Duplicate Group Name ($2): $gids"
  fi
done
```

## Expected Result

No results should be returned.

## Remediation

Based on the results of the audit script, establish unique names for the user groups. File group ownerships will automatically reflect the change as long as the groups have unique GIDs.

## Profile

- Level 1 - Server
