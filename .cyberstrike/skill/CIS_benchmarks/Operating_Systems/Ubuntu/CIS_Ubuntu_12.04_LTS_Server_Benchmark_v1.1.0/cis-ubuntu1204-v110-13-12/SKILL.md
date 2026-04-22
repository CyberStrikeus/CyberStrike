---
name: cis-ubuntu1204-v110-13-12
description: "Check That Users Are Assigned Valid Home Directories"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, user-management, home-directory, validation]
cis_id: "13.12"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 13.12 Check That Users Are Assigned Valid Home Directories (Scored)

## Profile Applicability
- Level 1

## Description
Users can be defined in `/etc/passwd` without a home directory or with a home directory that does not actually exist.

## Rationale
If the user's home directory does not exist or is unassigned, the user will be placed in "/" and will not be able to write any files or have local environment variables set.

## Audit Procedure
### Using Command Line
This script checks to make sure that home directories assigned in the `/etc/passwd` file exist.
```bash
#!/bin/bash
cat /etc/passwd | awk -F: '{ print $1 " " $3 " " $6 }' | while read user uid dir; do
if [ $uid -ge 500 -a ! -d "$dir" -a $user != "nfsnobody" -a $user != "nobody" ]; then
echo "The home directory ($dir) of user $user does not exist."
fi
done
```

## Expected Result
No output should be returned. Any output indicates users with non-existent home directories.

## Remediation
### Using Command Line
If any users' home directories do not exist, create them and make sure the respective user owns the directory. Users without an assigned home directory should be removed or assigned a home directory as appropriate.

## Default Value
Home directories are created automatically when using `useradd -m` or `adduser`.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
