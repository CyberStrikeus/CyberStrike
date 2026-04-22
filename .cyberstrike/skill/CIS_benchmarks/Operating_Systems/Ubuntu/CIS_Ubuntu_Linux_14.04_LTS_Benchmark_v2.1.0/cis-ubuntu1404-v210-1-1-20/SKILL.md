---
name: "CIS Ubuntu 14.04 LTS - 1.1.20 Ensure sticky bit is set on all world-writable directories"
description: "Ensure sticky bit is set on all world-writable directories to prevent unauthorized file deletion"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - filesystem
cis_id: "1.1.20"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 1.1.20 Ensure sticky bit is set on all world-writable directories (Scored)

## Profile Applicability
- Level 1 - Server
- Level 1 - Workstation

## Description
Setting the sticky bit on world writable directories prevents users from deleting or renaming files in that directory that are not owned by them.

## Rationale
This feature prevents the ability to delete or rename files in world writable directories (such as /tmp) that are owned by another user.

## Audit Procedure
```bash
# Run the following command to verify no world writable directories exist
# without the sticky bit set:
df --local -P | awk {'if (NR!=1) print $6'} | xargs -I '{}' find '{}' -xdev -type d \( -perm -0002 -a ! -perm -1000 \) 2>/dev/null
# No output should be returned.
```

## Expected Result
No output should be returned. Any output indicates world-writable directories without the sticky bit set.

## Remediation
```bash
# Run the following command to set the sticky bit on all world writable directories:
df --local -P | awk {'if (NR!=1) print $6'} | xargs -I '{}' find '{}' -xdev -type d -perm -0002 2>/dev/null | xargs chmod a+t
```

## Default Value
By default, not all world-writable directories have the sticky bit set.

## Notes
Some distributions may not support the --local option to df.

## References
- CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0
- CIS Controls: 13 Data Protection

## Profile
- Level 1
