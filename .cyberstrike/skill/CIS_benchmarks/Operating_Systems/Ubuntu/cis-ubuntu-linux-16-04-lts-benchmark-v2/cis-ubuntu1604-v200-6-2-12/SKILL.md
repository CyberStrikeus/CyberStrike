---
name: cis-ubuntu1604-v200-6-2-12
description: "Ensure root PATH Integrity"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, user-management, maintenance]
cis_id: "6.2.12"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 6.2.12

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

The `root` user can execute any command on the system and could be fooled into executing programs unintentionally if the `PATH` is not set correctly.

## Rationale

Including the current working directory (.) or other writable directory in `root`'s executable path makes it likely that an attacker can gain superuser access by forcing an administrator operating as `root` to execute a Trojan horse program.

## Audit Procedure

### Command Line

Run the following script and verify no results are returned:

```bash
#!/bin/bash
RPCV="$(sudo -Hiu root env | grep '^PATH' | cut -d= -f2)"
echo "$RPCV" | grep -q "::" && echo "root's path contains a empty directory (::)"
echo "$RPCV" | grep -q ":$" && echo "root's path contains a trailing (:)"
for x in $(echo "$RPCV" | tr ":" " "); do
    if [ -d "$x" ]; then
        ls -ldH "$x" | awk '$9 == "." {print "PATH contains current working directory (.)"}
            $3 != "root" {print $9, "is not owned by root"}
            substr($1,6,1) != "-" {print $9, "is group writable"}
            substr($1,9,1) != "-" {print $9, "is world writable"}'
    else
        echo "$x is not a directory"
    fi
done
```

## Expected Result

No output should be returned.

## Remediation

### Command Line

Correct or justify any items discovered in the Audit step.

## Default Value

N/A

## References

N/A

## CIS Controls

| Controls Version | Control                                                                                                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v7               | 5.1 Establish Secure Configurations<br/>Maintain documented, standard security configuration standards for all authorized operating systems and software. |      |      |      |
