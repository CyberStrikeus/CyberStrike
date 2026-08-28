---
name: "CIS Ubuntu 14.04 LTS - 6.2.19 Ensure no duplicate group names exist"
description: "Verify no duplicate group names exist in /etc/group"
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
cis_id: "6.2.19"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 6.2.19 Ensure no duplicate group names exist (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Although the `groupadd` program will not let you create a duplicate group name, it is possible for an administrator to manually edit the `/etc/group` file and change the group name.

## Rationale

If a group is assigned a duplicate group name, it will create and have access to files with the first GID for that group in `/etc/group`. Effectively, the GID is shared, which is a security problem.

## Audit Procedure

Run the following script and verify no results are returned:

```bash
#!/bin/bash

cat /etc/group | cut -f1 -d":" | sort -n | uniq -c | while read x ; do
  [ -z "${x}" ] && break
  set - $x
  if [ $1 -gt 1 ]; then
    gids=`gawk -F: '($1 == n) { print $3 }' n=$2 /etc/group | xargs`
    echo "Duplicate Group Name ($2): ${gids}"
  fi
done
```

## Expected Result

No output should be returned.

## Remediation

Based on the results of the audit script, establish unique names for the user groups. File group ownerships will automatically reflect the change as long as the groups have unique GIDs.

## Default Value

Not applicable.

## References

None

## CIS Controls

16 Account Monitoring and Control - Account Monitoring and Control

## Profile

- Level 1
