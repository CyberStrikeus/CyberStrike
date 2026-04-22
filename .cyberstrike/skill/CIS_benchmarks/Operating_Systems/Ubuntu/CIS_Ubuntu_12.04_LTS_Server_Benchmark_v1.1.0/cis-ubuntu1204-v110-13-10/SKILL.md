---
name: cis-ubuntu1204-v110-13-10
description: "Check for Presence of User .rhosts Files"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, user-management, rhosts, remote-access, legacy]
cis_id: "13.10"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 13.10 Check for Presence of User .rhosts Files (Scored)

## Profile Applicability
- Level 1

## Description
While no `.rhosts` files are shipped by default, users can easily create them.

## Rationale
This action is only meaningful if `.rhosts` support is permitted in the file `/etc/pam.conf`. Even though the `.rhosts` files are ineffective if support is disabled in `/etc/pam.conf`, they may have been brought over from other systems and could contain information useful to an attacker for those other systems.

## Audit Procedure
### Using Command Line
```bash
#!/bin/bash
for dir in `/bin/cat /etc/passwd | /bin/egrep -v '(root|halt|sync|shutdown)' |\
    /usr/bin/awk -F: '($7 != "/usr/sbin/nologin") { print $6 }'`; do
for file in $dir/.rhosts; do
        if [ ! -h "$file" -a -f "$file" ]; then
echo ".rhosts file in $dir"         fi      done
done
```

## Expected Result
No output should be returned. Any output indicates the presence of `.rhosts` files in user home directories.

## Remediation
### Using Command Line
If any users have `.rhosts` files determine why they have them.

## Default Value
No `.rhosts` files exist by default on Ubuntu 12.04.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
