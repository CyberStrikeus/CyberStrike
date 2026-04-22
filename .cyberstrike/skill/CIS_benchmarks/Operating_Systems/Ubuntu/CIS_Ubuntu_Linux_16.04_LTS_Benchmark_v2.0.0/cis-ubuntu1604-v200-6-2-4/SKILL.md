---
name: cis-ubuntu1604-v200-6-2-4
description: "Ensure all users' home directories exist"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, user-management, maintenance]
cis_id: "6.2.4"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 6.2.4

## Profile
- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

Users can be defined in `/etc/passwd` without a home directory or with a home directory that does not actually exist.

*Note: The audit script checks all users with interactive shells except `halt`, `sync`, `shutdown`, and `nfsnobody`.*

## Rationale

If the user's home directory does not exist or is unassigned, the user will be placed in "/" and will not be able to write any files or have local environment variables set.

## Audit Procedure

### Command Line

Run the following script and verify no results are returned:

```bash
#!/bin/bash
awk -F: '($1!~/(halt|sync|shutdown|nfsnobody)/ &&
$7!~/^(\/usr)?\/sbin\/nologin(\/)?\$/ && $7!~/(\/usr)?\/bin\/false(\/)?\$/) {
print $1 " " $6 }' /etc/passwd | while read -r user dir; do
      if [ ! -d "$dir" ]; then
              echo "User: \"$user\" home directory: \"$dir\" does not exist."
      fi
done
```

## Expected Result

No output should be returned.

## Remediation

### Command Line

If any users' home directories do not exist, create them and make sure the respective user owns the directory. Users without an assigned home directory should be removed or assigned a home directory as appropriate.

The following script will create a home directory for users with an interactive shell whose home directory doesn't exist:

```bash
#!/bin/bash
awk -F: '($1!~/(halt|sync|shutdown|nfsnobody)/ &&
$7!~/^(\/usr)?\/sbin\/nologin(\/)?\$/ && $7!~/(\/usr)?\/bin\/false(\/)?\$/) {
print $1 " " $6 }' /etc/passwd | while read -r user dir; do
  if [ ! -d "$dir" ]; then
    mkdir "$dir"
    chmod g-w,o-wrx "$dir"
    chown "$user" "$dir"
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
| v7 | 5.1 Establish Secure Configurations<br/>Maintain documented, standard security configuration standards for all authorized operating systems and software. | | | |
