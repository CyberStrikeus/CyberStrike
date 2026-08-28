---
name: cis-ubuntu1204-v110-13-7
description: "Check Permissions on User Home Directories"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, user-management, home-directory, permissions, file-permissions]
cis_id: "13.7"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 13.7 Check Permissions on User Home Directories (Scored)

## Profile Applicability

- Level 1

## Description

While the system administrator can establish secure permissions for users' home directories, the users can easily override these.

## Rationale

Group or world-writable user home directories may enable malicious users to steal or modify other users' data or to gain another user's system privileges.

## Audit Procedure

### Using Command Line

```bash
#!/bin/bash
for dir in `/bin/cat /etc/passwd  | /bin/egrep -v '(root|halt|sync|shutdown)' | /usr/bin/awk -F: '($7 != "/usr/sbin/nologin") { print $6 }'`; do if
[ -d $dir ]; then
        dirperm=`/bin/ls -ld $dir | /usr/bin/cut -f1 -d" "`
if [ `echo $dirperm | /usr/bin/cut -c6 ` != "-" ]; then
echo "Group Write permission set on directory $dir"           fi
        if [ `echo $dirperm | /usr/bin/cut -c8 ` != "-" ]; then
echo "Other Read permission set on directory $dir"            fi
        if [ `echo $dirperm | /usr/bin/cut -c9 ` != "-" ]; then
echo "Other Write permission set on directory $dir"           fi
        if [ `echo $dirperm | /usr/bin/cut -c10 ` != "-" ]; then
echo "Other Execute permission set on directory $dir"         fi
fi done
```

## Expected Result

No output should be returned. Any output indicates home directories with overly permissive settings.

## Remediation

### Using Command Line

Making global modifications to user home directories without alerting the user community can result in unexpected outages and unhappy users. Therefore, it is recommended that a monitoring policy be established to report user file permissions and determine the action to be taken in accordance with site policy.

## Default Value

Default home directory permissions are typically set to `755` (drwxr-xr-x) when created with `useradd`.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
