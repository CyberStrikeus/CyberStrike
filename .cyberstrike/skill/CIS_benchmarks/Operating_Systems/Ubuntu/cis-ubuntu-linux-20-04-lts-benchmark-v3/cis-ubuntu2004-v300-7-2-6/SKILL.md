---
name: cis-ubuntu2004-v300-7-2-6
description: "Ensure no duplicate GIDs exist"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, groups]
cis_id: "7.2.6"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.2.6 Ensure no duplicate GIDs exist (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Although the `groupadd` program will not let you create a duplicate Group ID (GID), it is possible for an administrator to manually edit the `/etc/group` file and change the GID field.

## Rationale

User groups must be assigned unique GIDs for accountability and to ensure appropriate access protections.

## Impact

None

## Audit Procedure

### Command Line

Run the following script and verify no results are returned:

```bash
#!/usr/bin/env bash

{
    while read -r l_count l_gid; do
        if [ "$l_count" -gt 1 ]; then
            echo -e "Duplicate GID: \"$l_gid\" Groups: \"$(awk -F: '($3 == n) { print $1 }' n=$l_gid /etc/group | xargs)\""
        fi
    done < <(cut -f3 -d":" /etc/group | sort -n | uniq -c)
}
```

## Expected Result

No output should be returned.

## Remediation

### Command Line

Based on the results of the audit script, establish unique GIDs and review all files owned by the shared GID to determine which group they are supposed to belong to.

## Default Value

N/A

## References

1. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## Additional Information

You can also use the `grpck` command to check for other inconsistencies in the `/etc/group` file.

## CIS Controls

| Controls Version | Control                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------- | ---- | ---- | ---- |
| v8               | 0.0 Explicitly Not Mapped |      |      |      |
| v7               | 0.0 Explicitly Not Mapped |      |      |      |

MITRE ATT&CK Mappings:

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1078, T1078.001, T1078.003 | TA0005  | M1027       |
