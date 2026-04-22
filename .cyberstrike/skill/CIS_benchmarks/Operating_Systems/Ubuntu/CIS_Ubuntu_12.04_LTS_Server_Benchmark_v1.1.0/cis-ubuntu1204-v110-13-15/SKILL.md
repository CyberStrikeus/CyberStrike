---
name: cis-ubuntu1204-v110-13-15
description: "Check for Duplicate GIDs"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, user-management, gid, duplicate, accountability]
cis_id: "13.15"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 13.15 Check for Duplicate GIDs (Scored)

## Profile Applicability
- Level 1

## Description
Although the `groupadd` program will not let you create a duplicate Group ID (GID), it is possible for an administrator to manually edit the `/etc/group` file and change the GID field.

## Rationale
User groups must be assigned unique GIDs for accountability and to ensure appropriate access protections.

## Audit Procedure
### Using Command Line
This script checks to make sure all GIDs in the `/etc/group` file are unique. You can also use the `/usr/sbin/grpck` command to check for other inconsistencies in the `/etc/group` file.
```bash
#!/bin/bash
/bin/cat /etc/group | /usr/bin/cut -f3 -d":" | /usr/bin/sort -n | /usr/bin/uniq -c |\
while read x ; do
    [ -z "${x}" ] && break
    set - $x
    if [ $1 -gt 1 ]; then
        grps=`/usr/bin/awk -F: '($3 == n) { print $1 }' n=$2 \
            /etc/group | xargs`
        echo "Duplicate GID ($2): ${grps}"
    fi
done
```

## Expected Result
No output should be returned. Any output indicates duplicate GIDs exist in `/etc/group`.

## Remediation
### Using Command Line
Based on the results of the script, establish unique GIDs and review all files owned by the shared GID to determine which group they are supposed to belong to.

## Default Value
The `groupadd` command assigns unique GIDs by default.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
