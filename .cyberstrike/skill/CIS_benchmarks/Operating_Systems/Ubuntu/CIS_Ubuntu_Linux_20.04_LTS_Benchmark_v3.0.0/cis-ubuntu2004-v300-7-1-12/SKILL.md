---
name: cis-ubuntu2004-v300-7-1-12
description: "Ensure no files or directories without an owner and a group exist"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, file-permissions]
cis_id: "7.1.12"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.1.12 Ensure no files or directories without an owner and a group exist (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Administrators may delete users or groups from the system and neglect to remove all files and/or directories owned by those users or groups.

## Rationale

A new user or group who is assigned a deleted user's user ID or group ID may then end up "owning" a deleted user or group's files, and thus have more access on the system than was intended.

## Impact

None

## Audit Procedure

### Command Line

Run the following script to verify no unowned or ungrouped files or directories exist:

```bash
#!/usr/bin/env bash

{
    l_output="" l_output2=""
    a_nouser=(); a_nogroup=() # Initialize arrays
    a_path=(! -path "/run/user/*" -a ! -path "/proc/*" -a ! -path "*/containerd/*" -a ! -path "*/kubelet/pods/*" -a ! -path "*/kubelet/plugins/*" -a ! -path "/sys/fs/cgroup/memory/*" -a ! -path "/var/*/private/*")
    while IFS= read -r l_mount; do
        while IFS= read -r -d $'\0' l_file; do
            if [ -e "$l_file" ]; then
                while IFS= read -r l_user l_group; do
                    [ "$l_user" = "UNKNOWN" ] && a_nouser+=("$l_file")
                    [ "$l_group" = "UNKNOWN" ] && a_nogroup+=("$l_file")
                done < <(stat -Lc '%U:%G' "$l_file")
            fi
        done < <(find "$l_mount" -xdev \( "${a_path[@]}" \) \( -type f -o -type d \) \( -nouser -o -nogroup \) -print0 2> /dev/null)
    done < <(findmnt -Dkerno fstype,target | awk '{$1 !~ /^\s*(nfs|proc|smb|vfat|iso9660|efivarfs|selinuxfs)/ && $2 !~ /^\/run\/user\//(print $2}')
    if ! (( ${#a_nouser[@]} > 0 )); then
        l_output="$l_output\n - No files or directories without a owner exist on the local filesystem."
    else
        l_output2="$l_output2\n - There are \"$(printf '%s' "${#a_nouser[@]}")\" unowned files or directories on the system.\n   - The following is a list of unowned files and/or directories:\n$(printf '%s\n' "${a_nouser[@]}")\n   - end of list\n"
    fi
    if ! (( ${#a_nogroup[@]} > 0 )); then
        l_output="$l_output\n - No files or directories without a group exist on the local filesystem."
    else
        l_output2="$l_output2\n - There are \"$(printf '%s' "${#a_nogroup[@]}")\" ungrouped files or directories on the system.\n   - The following is a list of ungrouped files and/or directories:\n$(printf '%s\n' "${a_nogroup[@]}")\n   - end of list\n"
    fi
    unset a_path; unset a_arr; unset a_nouser; unset a_nogroup # Remove arrays
    if [ -z "$l_output2" ]; then
        echo -e "\n- Audit Result:\n  ** PASS **\n - * Correctly configured * :\n$l_output\n"
    else
        echo -e "\n- Audit Result:\n  ** FAIL **\n - * Reasons for audit failure * :\n$l_output2"
        [ -n "$l_output" ] && echo -e "\n- * Correctly configured * :\n$l_output\n"
    fi
}
```

Note: On systems with a large number of files and/or directories, this audit may be a long running process.

## Expected Result

PASS -- No files or directories without an owner or group exist.

## Remediation

### Command Line

Remove or set ownership and group ownership of these files and/or directories to an active user on the system as appropriate.

## Default Value

N/A

## References

1. NIST SP 800-53 Rev. 5: AC-3. MP-2

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               | X    | X    | X    |
| v7               | 14.6 Protect Information through Access Control Lists | X    | X    | X    |

MITRE ATT&CK Mappings:

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1222, T1222.002            | TA0007  | M1022       |
