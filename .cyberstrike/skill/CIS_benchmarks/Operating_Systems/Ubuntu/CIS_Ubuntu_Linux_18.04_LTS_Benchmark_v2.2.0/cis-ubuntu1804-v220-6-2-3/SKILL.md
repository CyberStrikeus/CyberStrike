---
name: cis-ubuntu1804-v220-6-2-3
description: "Ensure all groups in /etc/passwd exist in /etc/group"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, groups]
cis_id: "6.2.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.3 Ensure all groups in /etc/passwd exist in /etc/group (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Over time, system administration errors and changes can lead to groups being defined in `/etc/passwd` but not in `/etc/group`.

## Rationale

Groups defined in the `/etc/passwd` file but not in the `/etc/group` file pose a threat to system security since group permissions are not properly managed.

## Audit Procedure

### Command Line

Run the following script to verify all GIDs in `/etc/passwd` exist in `/etc/group`:

```bash
#!/usr/bin/env bash

{
    a_passwd_group_gid="$(awk -F: '{print $4}' /etc/passwd | sort -u)"
    a_group_gid="$(awk -F: '{print $3}' /etc/group | sort -u)"
    a_passwd_group_diff="$(printf '%s\n' "${a_group_gid[@]}" "${a_passwd_group_gid[@]}" | sort | uniq -u)"
    while IFS= read -r l_gid; do
        awk -F: '($4 == "'$l_gid'") {print " - User: \"" $1 "\" has GID: \"" $4 "\" which does not exist in /etc/group"}' /etc/passwd
    done < <(printf '%s\n' "${a_group_gid[@]}" "${a_passwd_group_diff[@]}" | sort | uniq -D | uniq)
    unset a_passwd_group_gid; unset a_group_gid; unset a_passwd_group_diff
}
```

## Expected Result

Nothing should be returned.

## Remediation

### Command Line

Analyze the output of the Audit step above and perform the appropriate action to correct any discrepancies found.

## References

1. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## CIS Controls

- v8: **3.3** Configure Data Access Control Lists
- v8: **14.6** Train Workforce Members on Recognizing and Reporting Security Incidents
