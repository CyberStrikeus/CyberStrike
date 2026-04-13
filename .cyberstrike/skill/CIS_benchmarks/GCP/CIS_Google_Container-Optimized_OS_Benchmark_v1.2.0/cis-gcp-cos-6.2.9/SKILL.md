---
name: cis-gcp-cos-6.2.9
description: "Ensure users own their home directories"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, user-accounts, home-directories]
cis_id: "6.2.9"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.9 Ensure users own their home directories (Automated)

## Description

The user home directory is space defined for the particular user to set local environment variables and to store personal files.

## Rationale

Since the user is accountable for files stored in the user home directory, the user must be the owner of the directory.

## Audit Procedure

Run the following script and verify no results are returned:

```bash
#!/bin/bash

grep -E -v '^(halt|sync|shutdown)' /etc/passwd | awk -F: '($7 != "'"$(which nologin)"'" && $7 != "/bin/false") { print $1 " " $6 }' | while read user dir; do
  if [ ! -d "$dir" ]; then
    echo "The home directory ($dir) of user $user does not exist."
  else
    owner=$(stat -L -c "%U" "$dir")
    if [ "$owner" != "$user" ]; then
      echo "The home directory ($dir) of user $user is owned by $owner."
    fi
  fi
done
```

## Expected Result

No results should be returned.

## Remediation

Change the ownership of any home directories that are not owned by the defined user to the correct user.

## Additional Information

On some distributions the `/sbin/nologin` should be replaced with `/usr/sbin/nologin`.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists | x | x | x |
| v7 | 14.6 Protect Information through Access Control Lists | x | x | x |

## Profile

- Level 2 - Server
