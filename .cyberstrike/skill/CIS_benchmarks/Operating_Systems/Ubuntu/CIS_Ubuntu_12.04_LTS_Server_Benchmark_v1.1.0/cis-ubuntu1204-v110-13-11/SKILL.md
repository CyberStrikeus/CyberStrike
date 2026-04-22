---
name: cis-ubuntu1204-v110-13-11
description: "Check Groups in /etc/passwd"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, user-management, groups, passwd, consistency]
cis_id: "13.11"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 13.11 Check Groups in /etc/passwd (Scored)

## Profile Applicability

- Level 1

## Description

Over time, system administration errors and changes can lead to groups being defined in `/etc/passwd` but not in `/etc/group`.

## Rationale

Groups defined in the `/etc/passwd` file but not in the `/etc/group` file pose a threat to system security since group permissions are not properly managed.

## Audit Procedure

### Using Command Line

Create a script as shown below and run it:

```bash
#!/bin/bash
for i in $(cut -s -d: -f4 /etc/passwd | sort -u ); do
grep -q -P "^.*?:[^:]*:$i:" /etc/group
if [ $? -ne 0 ]; then
echo "Group $i is referenced by /etc/passwd but does not exist in /etc/group"
fi
done
```

## Expected Result

No output should be returned. Any output indicates groups referenced in `/etc/passwd` that do not exist in `/etc/group`.

## Remediation

### Using Command Line

Analyze the output of the Audit step above and perform the appropriate action to correct any discrepancies found.

## Default Value

All default system groups are properly defined in both `/etc/passwd` and `/etc/group`.

## References

- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0

## Profile

Level 1 - Scored
