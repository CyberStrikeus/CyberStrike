---
name: cis-ubuntu1204-v110-13-6
description: "Ensure root PATH Integrity"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, user-management, root, path, integrity]
cis_id: "13.6"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 13.6 Ensure root PATH Integrity (Scored)

## Profile Applicability
- Level 1

## Description
The `root` user can execute any command on the system and could be fooled into executing programs unintentionally if the `PATH` is not set correctly.

## Rationale
Including the current working directory (.) or other writable directory in `root`'s executable path makes it likely that an attacker can gain superuser access by forcing an administrator operating as `root` to execute a Trojan horse program.

## Audit Procedure
### Using Command Line
```bash
#!/bin/bash
if [ "`echo $PATH | grep ::`" != "" ]; then
  echo "Empty Directory in PATH (::)"
fi
if [ "`echo $PATH | bin/grep :$`" != "" ]; then
  echo "Trailing : in PATH"
fi
p=`echo $PATH | sed -e 's/::/:/' -e 's/:$//' -e 's/:/ /g'`
set -- $p
while [ "$1" != "" ]; do
  if [ "$1" = "." ]; then
    echo "PATH contains ."
    shift
    continue
  fi
  if [ -d $1 ]; then
    dirperm=`ls -ldH $1 | cut -f1 -d" "`
    if [ `echo $dirperm | cut -c6 ` != "-" ]; then
      echo "Group Write permission set on directory $1"
    fi
    if [ `echo $dirperm | cut -c9 ` != "-" ]; then
      echo "Other Write permission set on directory $1"
    fi
    dirown=`ls -ldH $1 | awk '{print $3}'`
    if [ "$dirown" != "root" ] ; then
      echo $1 is not owned by root
    fi
  else
    echo $1 is not a directory
  fi
  shift
done
```

## Expected Result
No output should be returned. Any output indicates a problem with the root PATH configuration.

## Remediation
### Using Command Line
Correct or justify any items discovered in the Audit step.

## Default Value
The default root PATH on Ubuntu 12.04 does not contain `.` or world-writable directories.

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile
Level 1 - Scored
