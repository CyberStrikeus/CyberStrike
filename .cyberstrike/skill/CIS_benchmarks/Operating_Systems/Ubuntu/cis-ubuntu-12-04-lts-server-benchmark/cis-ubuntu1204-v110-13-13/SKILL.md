---
name: cis-ubuntu1204-v110-13-13
description: "Check User Home Directory Ownership"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, user-management, home-directory, ownership, file-permissions]
cis_id: "13.13"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 13.13 Check User Home Directory Ownership (Scored)

## Profile Applicability

- Level 1

## Description

The user home directory is space defined for the particular user to set local environment variables and to store personal files.

## Rationale

Since the user is accountable for files stored in the user home directory, the user must be the owner of the directory.

## Audit Procedure

### Using Command Line

This script checks to make sure users own the home directory they are assigned to in the `/etc/passwd` file.

```bash
#!/bin/bash
cat /etc/passwd | awk -F: '{ print $1 " " $3 " " $6 }' | while read user uid dir; do
if [ $uid -ge 500 -a -d "$dir" -a $user != "nfsnobody" ]; then
  owner=$(stat -L -c "%U" "$dir")
  if [ "$owner" != "$user" ]; then
    echo "The home directory ($dir) of user $user is owned by $owner."
  fi
fi
done
```

## Expected Result

No output should be returned. Any output indicates home directories not owned by the assigned user.

## Remediation

### Using Command Line

Change the ownership of any home directories that are not owned by the defined user to the correct user.

## Default Value

Home directories are owned by the user when created with `useradd -m` or `adduser`.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
