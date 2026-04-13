---
name: cis-gcp-cos-6.2.6
description: "Ensure root PATH Integrity"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, user-accounts, home-directories]
cis_id: "6.2.6"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.6 Ensure root PATH Integrity (Automated)

## Description

The `root` user can execute any command on the system and could be fooled into executing programs unintentionally if the `PATH` is not set correctly.

## Rationale

Including the current working directory (.) or other writable directory in `root`'s executable path makes it likely that an attacker can gain superuser access by forcing an administrator operating as `root` to execute a Trojan horse program.

## Audit Procedure

Run the following script and verify no results are returned:

```bash
#!/bin/bash

PATH="$(sudo -Hiu root env | grep '^PATH' | cut -d= -f2)"
echo "$PATH" | grep -q "::" && echo "Empty directory in PATH (::)"
echo "$PATH" | grep -q ":$" && echo "Trailing : in PATH"
for dir in $(echo "$PATH" | tr ":" " "); do
    if [ -d "$dir" ]; then
        ls -ldH "$dir" | awk 'substr($1,6,1) != "-" {print $9, "is group writable"}
            substr($1,9,1) != "-" {print $9, "is world writable"}
            $3 != "root" {print $9, "is not owned by root"}'
    else
        base_dir=$(echo "$dir" | cut -d "/" -f2)
        # Ignore if directory is on read-only partition
        rw=$(findmnt -T "/$base_dir" | sed '1d' | grep -v "\sro,")
        if [ -n "$rw" ]; then
            echo "$dir is not a directory"
        fi
    fi
done
```

## Expected Result

No results should be returned.

## Remediation

Correct or justify any items discovered in the Audit step.

## CIS Controls

| Controls Version | Control                             | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------- | ---- | ---- | ---- |
| v7               | 5.1 Establish Secure Configurations | x    | x    | x    |

## Profile

- Level 2 - Server
