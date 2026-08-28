---
name: "CIS Ubuntu 14.04 LTS - 6.2.8 Ensure users' home directories permissions are 750 or more restrictive"
description: "Verify user home directories have permissions of 750 or more restrictive"
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
cis_id: "6.2.8"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 6.2.8 Ensure users' home directories permissions are 750 or more restrictive (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

While the system administrator can establish secure permissions for users' home directories, the users can easily override these.

## Rationale

Group or world-writable user home directories may enable malicious users to steal or modify other users' data or to gain another user's system privileges.

## Audit Procedure

Run the following script and verify no results are returned:

```bash
#!/bin/bash

cat /etc/passwd | egrep -v '^(root|halt|sync|shutdown)' | awk -F: '($7 != "/usr/sbin/nologin" && $7 != "/bin/false") { print $1 " " $6 }' | while read user dir; do
  if [ ! -d "$dir" ]; then
     echo "The home directory ($dir) of user $user does not exist."
  else
     dirperm=`ls -ld $dir | cut -f1 -d" "`
     if [ `echo $dirperm | cut -c6 ` != "-" ]; then
        echo "Group Write permission set on the home directory ($dir) of user $user"
     fi
     if [ `echo $dirperm | cut -c8` != "-" ]; then
        echo "Other Read permission set on the home directory ($dir) of user $user"
     fi
     if [ `echo $dirperm | cut -c9` != "-" ]; then
        echo "Other Write permission set on the home directory ($dir) of user $user"
     fi
     if [ `echo $dirperm | cut -c10` != "-" ]; then
        echo "Other Execute permission set on the home directory ($dir) of user $user"
     fi
  fi
done
```

## Expected Result

No output should be returned.

## Remediation

Making global modifications to user home directories without alerting the user community can result in unexpected outages and unhappy users. Therefore, it is recommended that a monitoring policy be established to report user file permissions and determine the action to be taken in accordance with site policy.

## Default Value

Not applicable.

## Notes

On some distributions the `/sbin/nologin` should be replaced with `/usr/sbin/nologin`.

## References

None

## CIS Controls

14.4 Protect Information With Access Control Lists - All information stored on systems shall be protected with file system, network share, claims, application, or database specific access control lists.

## Profile

- Level 1
