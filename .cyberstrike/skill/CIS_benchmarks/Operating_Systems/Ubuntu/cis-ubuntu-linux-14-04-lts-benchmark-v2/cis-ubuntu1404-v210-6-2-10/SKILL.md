---
name: "CIS Ubuntu 14.04 LTS - 6.2.10 Ensure users' dot files are not group or world writable"
description: "Verify user dot files do not have group or world write permissions"
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
cis_id: "6.2.10"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 6.2.10 Ensure users' dot files are not group or world writable (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

While the system administrator can establish secure permissions for users' "dot" files, the users can easily override these.

## Rationale

Group or world-writable user configuration files may enable malicious users to steal or modify other users' data or to gain another user's system privileges.

## Audit Procedure

Run the following script and verify no results are returned:

```bash
#!/bin/bash

cat /etc/passwd | egrep -v '^(root|halt|sync|shutdown)' | awk -F: '($7 != "/sbin/nologin" && $7 != "/bin/false") { print $1 " " $6 }' | while read user dir; do
  if [ ! -d "$dir" ]; then
     echo "The home directory ($dir) of user $user does not exist."
  else
     for file in $dir/.[A-Za-z0-9]*; do
       if [ ! -h "$file" -a -f "$file" ]; then
          fileperm=`ls -ld $file | cut -f1 -d" "`

          if [ `echo $fileperm | cut -c6`  != "-" ]; then
            echo "Group Write permission set on file $file"
          fi
          if [ `echo $fileperm | cut -c9`  != "-" ]; then
            echo "Other Write permission set on file $file"
          fi
       fi
     done
  fi
done
```

## Expected Result

No output should be returned.

## Remediation

Making global modifications to users' files without alerting the user community can result in unexpected outages and unhappy users. Therefore, it is recommended that a monitoring policy be established to report user dot file permissions and determine the action to be taken in accordance with site policy.

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
