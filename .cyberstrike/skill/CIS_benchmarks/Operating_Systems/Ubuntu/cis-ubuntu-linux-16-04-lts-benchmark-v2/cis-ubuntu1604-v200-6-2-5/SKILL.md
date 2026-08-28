---
name: cis-ubuntu1604-v200-6-2-5
description: "Ensure users own their home directories"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, user-management, maintenance]
cis_id: "6.2.5"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 6.2.5

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

The user home directory is space defined for the particular user to set local environment variables and to store personal files.

## Rationale

Since the user is accountable for files stored in the user home directory, the user must be the owner of the directory.

## Audit Procedure

### Command Line

Run the following script and verify no results are returned:

```bash
#!/bin/bash
awk -F: '($1!~/(halt|sync|shutdown)/ && $7!~/^(\/usr)?\/sbin\/nologin(\/)?\$/
&& $7!~/(\/usr)?\/bin\/false(\/)?\$/) { print $1 " " $6 }' | while read -r
user dir; do
  if [ ! -d "$dir" ]; then
    echo "User: \"$user\" home directory: \"$dir\" does not exist."
  else
    owner=$(stat -L -c "%U" "$dir")
    if [ "$owner" != "$user" ]; then
      echo "User: \"$user\" home directory: \"$dir\" is owned by \"$owner\""
    fi
  fi
done
```

## Expected Result

No output should be returned.

## Remediation

### Command Line

Change the ownership of any home directories that are not owned by the defined user to the correct user.

The following script will create missing home directories, set the owner, and set the permissions for interactive users' home directories:

```bash
#!/bin/bash
awk -F: '($1!~/(halt|sync|shutdown)/ && $7!~/^(\/usr)?\/sbin\/nologin(\/)?\$/
&& $7!~/(\/usr)?\/bin\/false(\/)?\$/) { print $1 " " $6 }' | while read -r
user dir; do
  if [ ! -d "$dir" ]; then
    echo "User: \"$user\" home directory: \"$dir\" does not exist, creating home directory"
    mkdir "$dir"
    chmod g-w,o-rwx "$dir"
    chown "$user" "$dir"
  else
    owner=$(stat -L -c "%U" "$dir")
    if [ "$owner" != "$user" ]; then
      chmod g-w,o-rwx "$dir"
      chown "$user" "$dir"
    fi
  fi
done
```

## Default Value

N/A

## References

N/A

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v7               | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. |      |      |      |
