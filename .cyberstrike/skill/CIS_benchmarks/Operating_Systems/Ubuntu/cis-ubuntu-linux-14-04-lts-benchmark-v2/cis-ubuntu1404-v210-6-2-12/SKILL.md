---
name: "CIS Ubuntu 14.04 LTS - 6.2.12 Ensure no users have .netrc files"
description: "Verify no users have .netrc files in their home directories"
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
cis_id: "6.2.12"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 6.2.12 Ensure no users have .netrc files (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `.netrc` file contains data for logging into a remote host for file transfers via FTP.

## Rationale

The `.netrc` file presents a significant security risk since it stores passwords in unencrypted form. Even if FTP is disabled, user accounts may have brought over `.netrc` files from other systems which could pose a risk to those systems.

## Audit Procedure

Run the following script and verify no results are returned:

```bash
#!/bin/bash

cat /etc/passwd | egrep -v '^(root|halt|sync|shutdown)' | awk -F: '($7 != "/sbin/nologin" && $7 != "/bin/false") { print $1 " " $6 }' | while read user dir; do
  if [ ! -d "$dir" ]; then
     echo "The home directory ($dir) of user $user does not exist."
  else
     if [ ! -h "$dir/.netrc" -a -f "$dir/.netrc" ]; then
        echo ".netrc file $dir/.netrc exists"
     fi
  fi
done
```

## Expected Result

No output should be returned.

## Remediation

Making global modifications to users' files without alerting the user community can result in unexpected outages and unhappy users. Therefore, it is recommended that a monitoring policy be established to report user `.netrc` files and determine the action to be taken in accordance with site policy.

## Default Value

Not applicable.

## References

None

## CIS Controls

16.14 Encrypt/Hash All Authentication Files And Monitor Their Access - Verify that all authentication files are encrypted or hashed and that these files cannot be accessed without root or administrator privileges. Audit all access to password files in the system.

## Profile

- Level 1
