---
name: "CIS Ubuntu 14.04 LTS - 6.2.7 Ensure all users' home directories exist"
description: "Verify that all users defined in /etc/passwd have existing home directories"
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
cis_id: "6.2.7"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 6.2.7 Ensure all users' home directories exist (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Users can be defined in `/etc/passwd` without a home directory or with a home directory that does not actually exist.

## Rationale

If the user's home directory does not exist or is unassigned, the user will be placed in "/" and will not be able to write any files or have local environment variables set.

## Audit Procedure

Run the following script and verify no results are returned:

```bash
#!/bin/bash

cat /etc/passwd | egrep -v '^(root|halt|sync|shutdown)' | awk -F: '($7 != "/usr/sbin/nologin" && $7 != "/bin/false") { print $1 " " $6 }' | while read user dir; do
  if [ ! -d "$dir" ]; then
     echo "The home directory ($dir) of user $user does not exist."
  fi
done
```

## Expected Result

No output should be returned.

## Remediation

If any users' home directories do not exist, create them and make sure the respective user owns the directory. Users without an assigned home directory should be removed or assigned a home directory as appropriate.

## Default Value

Not applicable.

## Notes

The audit script checks all users UID 500 and above except nfsnobody. Some distributions split at UID 1000 instead, consult your documentation and/or the `UID_MIN` setting in `/etc/login.defs` to determine which is appropriate for you.

## References

None

## CIS Controls

14.4 Protect Information With Access Control Lists - All information stored on systems shall be protected with file system, network share, claims, application, or database specific access control lists.

## Profile

- Level 1
