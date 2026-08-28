---
name: "CIS Ubuntu 14.04 LTS - 6.2.13 Ensure users' .netrc Files are not group or world accessible"
description: "Verify .netrc files are not accessible by group or world"
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
cis_id: "6.2.13"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 6.2.13 Ensure users' .netrc Files are not group or world accessible (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

While the system administrator can establish secure permissions for users' `.netrc` files, the users can easily override these.

## Rationale

`.netrc` files may contain unencrypted passwords that may be used to attack other systems.

## Audit Procedure

Run the following script and verify no results are returned:

```bash
#!/bin/bash

cat /etc/passwd | egrep -v '^(root|halt|sync|shutdown)' | awk -F: '($7 != "/sbin/nologin" && $7 != "/bin/false") { print $1 " " $6 }' | while read user dir; do
  if [ ! -d "$dir" ]; then
     echo "The home directory ($dir) of user $user does not exist."
  else
     for file in $dir/.netrc; do
       if [ ! -h "$file" -a -f "$file" ]; then
          fileperm=`ls -ld $file | cut -f1 -d" "`
          if [ `echo $fileperm | cut -c5`  != "-" ]; then
            echo "Group Read set on $file"
          fi
          if [ `echo $fileperm | cut -c6`  != "-" ]; then
            echo "Group Write set on $file"
          fi
          if [ `echo $fileperm | cut -c7`  != "-" ]; then
            echo "Group Execute set on $file"
          fi
          if [ `echo $fileperm | cut -c8`  != "-" ]; then
            echo "Other Read set on $file"
          fi
          if [ `echo $fileperm | cut -c9`  != "-" ]; then
            echo "Other Write set on $file"
          fi
          if [ `echo $fileperm | cut -c10`  != "-" ]; then
            echo "Other Execute set on $file"
          fi
       fi
     done
  fi
done
```

## Expected Result

No output should be returned.

## Remediation

Making global modifications to users' files without alerting the user community can result in unexpected outages and unhappy users. Therefore, it is recommended that a monitoring policy be established to report user `.netrc` file permissions and determine the action to be taken in accordance with site policy.

## Default Value

Not applicable.

## Notes

While the complete removal of .netrc files is recommended if any are required on the system secure permissions must be applied.

On some distributions the `/sbin/nologin` should be replaced with `/usr/sbin/nologin`.

## References

None

## CIS Controls

14.4 Protect Information With Access Control Lists - All information stored on systems shall be protected with file system, network share, claims, application, or database specific access control lists.

## Profile

- Level 1
