---
name: cis-ubuntu1604-v200-6-2-7
description: "Ensure users' dot files are not group or world writable"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, user-management, maintenance]
cis_id: "6.2.7"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 6.2.7

## Profile
- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

While the system administrator can establish secure permissions for users' "dot" files, the users can easily override these.

## Rationale

Group or world-writable user configuration files may enable malicious users to steal or modify other users' data or to gain another user's system privileges.

## Audit Procedure

### Command Line

Run the following script and verify no results are returned:

```bash
#!/bin/bash
awk -F: '($1!~/(halt|sync|shutdown)/ && $7!~/^(\/usr)?\/sbin\/nologin(\/)?\$/
&& $7!~/(\/usr)?\/bin\/false(\/)?\$/) { print $1 " " $6 }' /etc/passwd | while
read -r user dir; do
  if [ -d "$dir" ]; then
    for file in "$dir"/.*; do
      if [ ! -h "$file" ] && [ -f "$file" ]; then
        fileperm=$(stat -L -c "%A" "$file")
        if [ "$(echo "$fileperm" | cut -c6)" != "-" ] || [ "$(echo
"$fileperm" | cut -c9)" != "-" ]; then
          echo "User: \"$user\" file: \"$file\" has permissions:
\"$fileperm\""
        fi
      fi
    done
  fi
done
```

## Expected Result

No output should be returned.

## Remediation

### Command Line

Making global modifications to users' files without alerting the user community can result in unexpected outages and unhappy users. Therefore, it is recommended that a monitoring policy be established to report user dot file permissions and determine the action to be taken in accordance with site policy.

The following script will remove excessive permissions on `dot` files within interactive users' home directories.

```bash
#!/bin/bash
awk -F: '($1!~/(halt|sync|shutdown)/ && $7!~/^(\/usr)?\/sbin\/nologin(\/)?\$/
&& $7!~/(\/usr)?\/bin\/false(\/)?\$/) { print $1 " " $6 }' | while read -r
user dir; do
  if [ -d "$dir" ]; then
    for file in "$dir"/.*; do
      if [ ! -h "$file" ] && [ -f "$file" ]; then
        fileperm=$(stat -L -c "%A" "$file")
        if [ "$(echo "$fileperm" | cut -c6)" != "-" ] || [ "$(echo
"$fileperm" | cut -c9)" != "-" ]; then
          chmod go-w "$file"
        fi
      fi
    done
  fi
done
```

## Default Value

N/A

## References

N/A

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v7 | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | | | |
