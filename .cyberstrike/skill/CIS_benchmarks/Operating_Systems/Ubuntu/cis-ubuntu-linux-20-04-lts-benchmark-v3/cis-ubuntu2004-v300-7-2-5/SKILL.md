---
name: cis-ubuntu2004-v300-7-2-5
description: "Ensure no duplicate UIDs exist"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, users]
cis_id: "7.2.5"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.2.5 Ensure no duplicate UIDs exist (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Although the `useradd` program will not let you create a duplicate User ID (UID), it is possible for an administrator to manually edit the `/etc/passwd` file and change the UID field.

## Rationale

Users must be assigned unique UIDs for accountability and to ensure appropriate access protections.

Satisfies: SRG-OS-000104-GPOS-00051, SRG-OS-000121-GPOS-00062, SRG-OS-000042-GPOS-00020

## Impact

None

## Audit Procedure

### Command Line

Run the following script and verify no results are returned:

```bash
#!/usr/bin/env bash

{
    while read -r l_count l_uid; do
        if [ "$l_count" -gt 1 ]; then
            echo -e "Duplicate UID: \"$l_uid\" Users: \"$(awk -F: '($3 == n) { print $1 }' n=$l_uid /etc/passwd | xargs)\""
        fi
    done < <(cut -f3 -d":" /etc/passwd | sort -n | uniq -c)
}
```

## Expected Result

No output should be returned.

## Remediation

### Command Line

Based on the results of the audit script, establish unique UIDs and review all files owned by the shared UIDs to determine which UID they are supposed to belong to.

## Default Value

N/A

## References

1. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5
2. NIST SP 800-53A :: IA-2.1

## Additional Information

You can also use the `pwck` command to check for other inconsistencies in the `/etc/passwd` file.

## CIS Controls

| Controls Version | Control                   | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------- | ---- | ---- | ---- |
| v8               | 0.0 Explicitly Not Mapped |      |      |      |
| v7               | 0.0 Explicitly Not Mapped |      |      |      |

MITRE ATT&CK Mappings:

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1078, T1078.001, T1078.003 | TA0005  | M1027       |
