---
name: cis-gcp-cos-6.2.14
description: "Ensure no users have .rhosts files"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, user-accounts, rhosts]
cis_id: "6.2.14"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.14 Ensure no users have .rhosts files (Automated)

## Description

While no `.rhosts` files are shipped by default, users can easily create them.

## Rationale

This action is only meaningful if `.rhosts` support is permitted in the file `/etc/pam.conf`. Even though the `.rhosts` files are ineffective if support is disabled in `/etc/pam.conf`, they may have been brought over from other systems and could contain information useful to an attacker for those other systems.

## Audit Procedure

Run the following script and verify no results are returned:

```bash
#!/bin/bash

grep -E -v '^(root|halt|sync|shutdown)' /etc/passwd | awk -F: '($7 != "'"$(which nologin)"'" && $7 != "/bin/false") { print $1 " " $6 }' | while read user dir; do
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

No results should be returned.

## Remediation

Making global modifications to users' files without alerting the user community can result in unexpected outages and unhappy users. Therefore, it is recommended that a monitoring policy be established to report user `.rhosts` files and determine the action to be taken in accordance with site policy.

## Additional Information

On some distributions the `/sbin/nologin` should be replaced with `/usr/sbin/nologin`.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.11 Encrypt Sensitive Data at Rest | | x | x |
| v7 | 16.4 Encrypt or Hash all Authentication Credentials | | x | x |

## Profile

- Level 2 - Server
