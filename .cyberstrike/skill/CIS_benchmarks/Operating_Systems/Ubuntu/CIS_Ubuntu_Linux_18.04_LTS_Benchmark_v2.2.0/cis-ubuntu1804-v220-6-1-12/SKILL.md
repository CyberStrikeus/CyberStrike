---
name: cis-ubuntu1804-v220-6-1-12
description: "Ensure SUID and SGID files are reviewed"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, file-permissions]
cis_id: "6.1.12"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.1.12 Ensure SUID and SGID files are reviewed (Manual)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The owner of a file can set the file's permissions to run with the owner's or group's permissions, even if the user running the program is not the owner or a member of the group. The most common reason for a SUID or SGID program is to enable users to perform functions (such as changing their password) that require root privileges.

## Rationale

There are valid reasons for SUID and SGID programs, but it is important to identify and review such programs to ensure they are legitimate. Review the files returned by the action in the audit section and check to see if system binaries have a different checksum than what from the package. This is an indication that the binary may have been replaced.

## Audit Procedure

### Command Line

Run the following script to generate a list of SUID and SGID files:

```bash
#!/usr/bin/env bash

{
    l_output="" l_output2=""
    a_suid=(); a_sgid=() # initialize arrays
    while IFS= read -r l_mount_point; do
        if ! grep -Pqs '^\h*\/run\/usr\b' <<< "$l_mount_point" && ! grep -Pqs -- '\bnoexec\b' <<< "$(findmnt -krn "$l_mount_point")"; then
            while  IFS= read -r -d $'\0' l_file; do
                if [ -e "$l_file" ]; then
                    l_mode="$(stat -Lc '%#a' "$l_file")"
                    [ $(( $l_mode & 04000 )) -gt 0 ] && a_suid+=("$l_file")
                    [ $(( $l_mode & 02000 )) -gt 0 ] && a_sgid+=("$l_file")
                fi
            done < <(find "$l_mount_point" -xdev -type f \( -perm -2000 -o -perm -4000 \) -print0 2>/dev/null)
        fi
    done <<< "$(findmnt -Derno target)"
    if ! (( ${#a_suid[@]} > 0 )); then
        l_output="$l_output\n - No executable SUID files exist on the system"
    else
        l_output2="$l_output2\n - List of \"$(printf '%s' "${#a_suid[@]}")\" SUID executable files:\n$(printf '%s\n' "${a_suid[@]}")\n - end of list -\n"
    fi
    if ! (( ${#a_sgid[@]} > 0 )); then
        l_output="$l_output\n - There are no SGID files exist on the system"
    else
        l_output2="$l_output2\n - List of \"$(printf '%s' "${#a_sgid[@]}")\" SGID executable files:\n$(printf '%s\n' "${a_sgid[@]}")\n - end of list -\n"
    fi
    [ -n "$l_output2" ] && l_output2="$l_output2\n- Review the preceding list(s) of SUID and/or SGID files to\n- ensure that no rogue programs have been introduced onto the system.\n"
    unset a_arr; unset a_suid; unset a_sgid # Remove arrays
    # If l_output2 is empty, Nothing to report
    if [ -z "$l_output2" ]; then
        echo -e "\n- Audit Result:\n$l_output\n"
    else
        echo -e "\n- Audit Result:\n$l_output2\n"
        [ -n "$l_output" ] && echo -e "$l_output\n"
    fi
}
```

**Note:** On systems with a large number of files, this may be a long running process.

## Expected Result

Review the output to ensure no rogue SUID or SGID programs have been introduced into the system.

## Remediation

### Command Line

Ensure that no rogue SUID or SGID programs have been introduced into the system. Review the files returned by the action in the Audit section and confirm the integrity of these binaries.

## References

1. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5, AC-3, MP-2

## CIS Controls

- v8: **3.3** Configure Data Access Control Lists
- v7: **14.6** Protect Information through Access Control Lists
