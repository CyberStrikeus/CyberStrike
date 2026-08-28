---
name: "CIS Ubuntu 14.04 LTS - 6.2.14 Ensure no users have .rhosts files"
description: "Verify no users have .rhosts files in their home directories"
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
cis_id: "6.2.14"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 6.2.14 Ensure no users have .rhosts files (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

While no `.rhosts` files are shipped by default, users can easily create them.

## Rationale

This action is only meaningful if `.rhosts` support is permitted in the file `/etc/pam.conf`. Even though the `.rhosts` files are ineffective if support is disabled in `/etc/pam.conf`, they may have been brought over from other systems and could contain information useful to an attacker for those other systems.

## Audit Procedure

Run the following script and verify no results are returned:

```bash
#!/bin/bash

cat /etc/passwd | egrep -v '^(root|halt|sync|shutdown)' | awk -F: '($7 != "/sbin/nologin" && $7 != "/bin/false") { print $1 " " $6 }' | while read user dir; do
  if [ ! -d "$dir" ]; then
     echo "The home directory ($dir) of user $user does not exist."
  else
     for file in $dir/.rhosts; do
       if [ ! -h "$file" -a -f "$file" ]; then
          echo ".rhosts file in $dir"
       fi
     done
  fi
done
```

## Expected Result

No output should be returned.

## Remediation

Making global modifications to users' files without alerting the user community can result in unexpected outages and unhappy users. Therefore, it is recommended that a monitoring policy be established to report user `.rhosts` files and determine the action to be taken in accordance with site policy.

## Default Value

Not applicable.

## Notes

On some distributions the `/sbin/nologin` should be replaced with `/usr/sbin/nologin`.

## References

None

## CIS Controls

16.14 Encrypt/Hash All Authentication Files And Monitor Their Access - Verify that all authentication files are encrypted or hashed and that these files cannot be accessed without root or administrator privileges. Audit all access to password files in the system.

## Profile

- Level 1
