---
name: "CIS Ubuntu 14.04 LTS - 6.2.15 Ensure all groups in /etc/passwd exist in /etc/group"
description: "Verify all groups referenced in /etc/passwd exist in /etc/group"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - user-accounts
cis_id: "6.2.15"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 6.2.15 Ensure all groups in /etc/passwd exist in /etc/group (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Over time, system administration errors and changes can lead to groups being defined in `/etc/passwd` but not in `/etc/group`.

## Rationale

Groups defined in the `/etc/passwd` file but not in the `/etc/group` file pose a threat to system security since group permissions are not properly managed.

## Audit Procedure

Run the following script and verify no results are returned:

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

No output should be returned.

## Remediation

Analyze the output of the Audit step above and perform the appropriate action to correct any discrepancies found.

## Default Value

Not applicable.

## References

None

## CIS Controls

16 Account Monitoring and Control - Account Monitoring and Control

## Profile

- Level 1
