---
name: cis-ubuntu2004-v300-7-2-7
description: "Ensure no duplicate user names exist"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, users]
cis_id: "7.2.7"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.2.7 Ensure no duplicate user names exist (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Although the `useradd` program will not let you create a duplicate user name, it is possible for an administrator to manually edit the `/etc/passwd` file and change the user name.

## Rationale

If a user is assigned a duplicate user name, it will create and have access to files with the first UID for that username in `/etc/passwd`. For example, if "test4" has a UID of 1000 and a subsequent "test4" entry has a UID of 2000, logging in as "test4" will use UID 1000. Effectively, the UID is shared, which is a security problem.

## Impact

None

## Audit Procedure

### Command Line

Run the following script and verify no results are returned:

```bash
#!/usr/bin/env bash

{
    while read -r l_count l_user; do
        if [ "$l_count" -gt 1 ]; then
            echo -e "Duplicate User: \"$l_user\" Users: \"$(awk -F: '($1 == n) { print $1 }' n=$l_user /etc/passwd | xargs)\""
        fi
    done < <(cut -f1 -d":" /etc/passwd | sort -n | uniq -c)
}
```

## Expected Result

No output should be returned.

## Remediation

### Command Line

Based on the results of the audit script, establish unique user names for the users. File ownerships will automatically reflect the change as long as the users have unique UIDs.

## Default Value

N/A

## References

1. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 0.0 Explicitly Not Mapped | | | |
| v7 | 0.0 Explicitly Not Mapped | | | |

MITRE ATT&CK Mappings:

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1078, T1078.001, T1078.003 | TA0004 | M1027 |
