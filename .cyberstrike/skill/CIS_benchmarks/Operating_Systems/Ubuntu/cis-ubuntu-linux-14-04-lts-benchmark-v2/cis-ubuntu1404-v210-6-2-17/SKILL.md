---
name: "CIS Ubuntu 14.04 LTS - 6.2.17 Ensure no duplicate GIDs exist"
description: "Verify no duplicate Group IDs exist in /etc/group"
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
cis_id: "6.2.17"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 6.2.17 Ensure no duplicate GIDs exist (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Although the `groupadd` program will not let you create a duplicate Group ID (GID), it is possible for an administrator to manually edit the `/etc/group` file and change the GID field.

## Rationale

User groups must be assigned unique GIDs for accountability and to ensure appropriate access protections.

## Audit Procedure

Run the following script and verify no results are returned:

```bash
#!/bin/bash

cat /etc/group | cut -f3 -d":" | sort -n | uniq -c | while read x ; do
  [ -z "${x}" ] && break
  set - $x
  if [ $1 -gt 1 ]; then
    groups=`awk -F: '($3 == n) { print $1 }' n=$2 /etc/group | xargs`
    echo "Duplicate GID ($2): ${groups}"
  fi
done
```

## Expected Result

No output should be returned.

## Remediation

Based on the results of the audit script, establish unique GIDs and review all files owned by the shared GID to determine which group they are supposed to belong to.

## Default Value

Not applicable.

## Notes

You can also use the `grpck` command to check for other inconsistencies in the `/etc/group` file.

## References

None

## CIS Controls

16 Account Monitoring and Control - Account Monitoring and Control

## Profile

- Level 1
