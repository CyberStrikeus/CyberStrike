---
name: cis-ubuntu1604-v200-6-2-10
description: "Ensure no users have .rhosts files"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, user-management, maintenance]
cis_id: "6.2.10"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 6.2.10

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

While no `.rhosts` files are shipped by default, users can easily create them.

## Rationale

This action is only meaningful if `.rhosts` support is permitted in the file `/etc/pam.conf`. Even though the `.rhosts` files are ineffective if support is disabled in `/etc/pam.conf`, they may have been brought over from other systems and could contain information useful to an attacker for those other systems.

## Audit Procedure

### Command Line

Run the following script and verify no lines are returned:

```bash
#!/bin/bash
awk -F: '($1!~/(root|halt|sync|shutdown)/ &&
$7!~/^(\/usr)?\/sbin\/nologin(\/)?\$/ && $7!~/(\/usr)?\/bin\/false(\/)?\$/) {
print $1 " " $6 }' /etc/passwd | while read -r user dir; do
  if [ -d "$dir" ]; then
    file="$dir/.rhosts"
    if [ ! -h "$file" ] && [ -f "$file" ]; then
      echo "User: \"$user\" file: \"$file\" exists"
    fi
  fi
done
```

## Expected Result

No output should be returned.

## Remediation

### Command Line

Making global modifications to users' files without alerting the user community can result in unexpected outages and unhappy users. Therefore, it is recommended that a monitoring policy be established to report user `.rhosts` files and determine the action to be taken in accordance with site policy.

The following script will remove `.rhosts` files from interactive users' home directories:

```bash
#!/bin/bash
awk -F: '($1!~/(root|halt|sync|shutdown)/ &&
$7!~/^(\/usr)?\/sbin\/nologin(\/)?\$/ && $7!~/(\/usr)?\/bin\/false(\/)?\$/) {
print $6 }' /etc/passwd | while read -r dir; do
  if [ -d "$dir" ]; then
    file="$dir/.rhosts"
    [ ! -h "$file" ] && [ -f "$file" ] && rm -r "$file"
  fi
done
```

## Default Value

N/A

## References

N/A

## CIS Controls

| Controls Version | Control                                                                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v7               | 16.4 Encrypt or Hash all Authentication Credentials<br/>Encrypt or hash with a salt all authentication credentials when stored. |      |      |      |
