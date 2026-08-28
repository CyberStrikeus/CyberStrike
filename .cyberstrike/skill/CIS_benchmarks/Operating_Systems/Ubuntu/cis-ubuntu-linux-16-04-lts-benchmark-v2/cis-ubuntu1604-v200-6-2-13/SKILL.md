---
name: cis-ubuntu1604-v200-6-2-13
description: "Ensure no duplicate UIDs exist"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, user-management, maintenance]
cis_id: "6.2.13"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 6.2.13

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

Although the `useradd` program will not let you create a duplicate User ID (UID), it is possible for an administrator to manually edit the `/etc/passwd` file and change the UID field.

## Rationale

Users must be assigned unique UIDs for accountability and to ensure appropriate access protections.

## Audit Procedure

### Command Line

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

No output should be returned.

## Remediation

### Command Line

Based on the results of the audit script, establish unique UIDs and review all files owned by the shared UIDs to determine which UID they are supposed to belong to.

## Default Value

N/A

## References

N/A

## CIS Controls

| Controls Version | Control                                                              | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------- | ---- | ---- | ---- |
| v7               | 16 Account Monitoring and Control<br/>Account Monitoring and Control |      |      |      |
