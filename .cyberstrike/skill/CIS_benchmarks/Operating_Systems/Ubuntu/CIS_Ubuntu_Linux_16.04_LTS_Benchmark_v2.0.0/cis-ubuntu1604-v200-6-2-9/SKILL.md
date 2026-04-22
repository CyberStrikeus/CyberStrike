---
name: cis-ubuntu1604-v200-6-2-9
description: "Ensure no users have .forward files"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, user-management, maintenance]
cis_id: "6.2.9"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 6.2.9

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

The `.forward` file specifies an email address to forward the user's mail to.

## Rationale

Use of the `.forward` file poses a security risk in that sensitive data may be inadvertently transferred outside the organization. The `.forward` file also poses a risk as it can be used to execute commands that may perform unintended actions.

## Audit Procedure

### Command Line

Run the following script and verify no lines are returned:

```bash
#!/bin/bash
awk -F: '($1!~/(root|halt|sync|shutdown)/ &&
$7!~/^(\/usr)?\/sbin\/nologin(\/)?\$/ && $7!~/(\/usr)?\/bin\/false(\/)?\$/) {
print $1 " " $6 }' /etc/passwd | while read -r user dir; do
  if [ -d "$dir" ]; then
    file="$dir/.forward"
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

Making global modifications to users' files without alerting the user community can result in unexpected outages and unhappy users. Therefore, it is recommended that a monitoring policy be established to report user `.forward` files and determine the action to be taken in accordance with site policy.

The following script will remove `.forward` files from interactive users' home directories:

```bash
#!/bin/bash
awk -F: '($1!~/(root|halt|sync|shutdown)/ &&
$7!~/^(\/usr)?\/sbin\/nologin(\/)?\$/ && $7!~/(\/usr)?\/bin\/false(\/)?\$/) {
print $6 }' /etc/passwd | while read -r dir; do
  if [ -d "$dir" ]; then
    file="$dir/.forward"
    [ ! -h "$file" ] && [ -f "$file" ] && rm -r "$file"
  fi
done
```

## Default Value

N/A

## References

N/A

## CIS Controls

| Controls Version | Control                                                                                                                                                   | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v7               | 5.1 Establish Secure Configurations<br/>Maintain documented, standard security configuration standards for all authorized operating systems and software. |      |      |      |
