---
name: cis-ubuntu1204-v110-13-8
description: "Check User Dot File Permissions"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, user-management, dot-files, permissions, file-permissions]
cis_id: "13.8"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 13.8 Check User Dot File Permissions (Scored)

## Profile Applicability
- Level 1

## Description
While the system administrator can establish secure permissions for users' "dot" files, the users can easily override these.

## Rationale
Group or world-writable user configuration files may enable malicious users to steal or modify other users' data or to gain another user's system privileges.

## Audit Procedure
### Using Command Line
```bash
#!/bin/bash
for dir in `/bin/cat /etc/passwd | /bin/egrep -v '(root|sync|halt|shutdown)' | /usr/bin/awk -F: '($7 != "/usr/sbin/nologin") { print $6 }'`; do
for file in $dir/.[A-Za-z0-9]*; do          if [ ! -h "$file" -a -f "$file" ]; then
          fileperm=`/bin/ls -ld $file | /usr/bin/cut -f1 -d" "`
if [ `echo $fileperm | /usr/bin/cut -c6 ` != "-" ]; then
echo "Group Write permission set on file $file"              fi
          if [ `echo $fileperm | /usr/bin/cut -c9 ` != "-" ]; then
echo "Other Write permission set on file $file"              fi
fi     done done
```

## Expected Result
No output should be returned. Any output indicates dot files with group or world write permissions.

## Remediation
### Using Command Line
Making global modifications to users' files without alerting the user community can result in unexpected outages and unhappy users. Therefore, it is recommended that a monitoring policy be established to report user dot file permissions and determine the action to be taken in accordance with site policy.

## Default Value
Dot files are typically created with the user's default umask, which should restrict group and world write access.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
