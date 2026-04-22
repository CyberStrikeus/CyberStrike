---
name: cis-ubuntu1804-v220-6-2-9
description: "Ensure local interactive user home directories are configured"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, users]
cis_id: "6.2.9"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.9 Ensure local interactive user home directories are configured (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The user home directory is space defined for the particular user to set local environment variables and to store personal files. While the system administrator can establish secure permissions for users' home directories, the users can easily override these. Users can be defined in `/etc/passwd` without a home directory or with a home directory that does not actually exist.

## Rationale

Since the user is accountable for files stored in the user home directory, the user must be the owner of the directory. Group or world-writable user home directories may enable malicious users to steal or modify other users' data or to gain another user's system privileges. If the user's home directory does not exist or is unassigned, the user will be placed in "/" and will not be able to write any files or have local environment variables set.

## Audit Procedure

### Command Line

Run the following script to Ensure:

- local interactive user home directories exist
- Ensure local interactive users own their home directories
- Ensure local interactive user home directories are mode 750 or more restrictive

```bash
#!/usr/bin/env bash

{
    l_output="" l_output2="" i_heout2="" l_hoout2="" l_haout2=""
    l_valid_shells="^$($ awk -F\/ '$NF != "nologin" {print}' /etc/shells | sed -rn '/^\//{s,/,\\/,g;p}' | paste -s -d '|' - ))$"
    unset a_uarr && a_uarr=() # Clear and initialize array
    while read -r l_epu l_eph; do # Populate array with users and user home location
        a_uarr+=("$l_epu $l_eph")
    done <<< "$(awk -v pat="$l_valid_shells" -F: '$(NF) ~ pat { print $1 " " $(NF-1) }' /etc/passwd)"
    l_asize="${#a_uarr[@]}" # Here if we want to look at number of users before proceeding
    [ "$l_asize " -gt "10000" ] && echo -e "\n  ** INFO **\n  - \"$l_asize\" Local interactive users found on the system\n  - This may be a long running check\n"
    while read -r l_user l_home; do
        if [ -d "$l_home" ]; then
            l_mask='0027'
            l_max="$(printf '%o' $(( 0777 & ~$l_mask)) )"
            while read -r l_own l_mode; do
                [ "$l_user" != "$l_own" ] && l_hoout2="$l_hoout2\n  - User: \"$l_user\" Home \"$l_home\" is owned by: \"$l_own\""
                if [ $(( $l_mode & $l_mask )) -gt 0 ]; then
                    l_haout2="$l_haout2\n  - User: \"$l_user\" Home \"$l_home\" is mode: \"$l_mode\" should be mode: \"$l_max\" or more restrictive"
                fi
            done <<< "$(stat -Lc '%U %#a' "$l_home")"
        else
            l_heout2="$l_heout2\n  - User: \"$l_user\" Home \"$l_home\" Doesn't exist"
        fi
    done <<< "$(printf '%s\n' "${a_uarr[@]}")"
    [ -z "$l_heout2" ] && l_output="$l_output\n   - home directories exist" || l_output2="$l_output2$l_heout2"
    [ -z "$l_hoout2" ] && l_output="$l_output\n   - own their home directory" || l_output2="$l_output2$l_hoout2"
    [ -z "$l_haout2" ] && l_output="$l_output\n   - home directories are mode: \"$l_max\" or more restrictive"
    || l_output2="$l_output2$l_haout2"
    [ -n "$l_output" ] && l_output="  - All local interactive users:$l_output"
    if [ -z "$l_output2" ]; then # If l_output2 is empty, we pass
        echo -e "\n- Audit Result:\n  ** PASS **\n - * Correctly configured * :\n$l_output\n"
    else
        echo -e "\n- Audit Result:\n  ** FAIL **\n - * Reasons for audit failure * :\n$l_output2"
        [ -n "$l_output" ] && echo -e "\n- * Correctly configured * :\n$l_output\n"
    fi
}
```

## Expected Result

```
- Audit Result:
  ** PASS **
 - * Correctly configured *
```

## Remediation

### Command Line

If a local interactive users' home directory is undefined and/or doesn't exist, follow local site policy and perform one of the following:

- Lock the user account
- Remove the user from the system
- create a directory for the user. If undefined, edit `/etc/passwd` and add the absolute path to the directory to the last field of the user.

Run the following script to:

- Remove excessive permissions from local interactive users home directories
- Update the home directory's owner

```bash
#!/usr/bin/env bash

{
    l_output2=""
    l_valid_shells="^$($ awk -F\/ '$NF != "nologin" {print}' /etc/shells | sed -rn '/^\//{s,/,\\/,g;p}' | paste -s -d '|' - ))$"
    unset a_uarr && a_uarr=() # Clear and initialize array
    while read -r l_epu l_eph; do # Populate array with users and user home location
        a_uarr+=("$l_epu $l_eph")
    done <<< "$(awk -v pat="$l_valid_shells" -F: '$(NF) ~ pat { print $1 " " $(NF-1) }' /etc/passwd)"
    l_asize="${#a_uarr[@]}" # Here if we want to look at number of users before proceeding
    [ "$l_asize " -gt "10000" ] && echo -e "\n  ** INFO **\n  - \"$l_asize\" Local interactive users found on the system\n  - This may be a long running process\n"
    while read -r l_user l_home; do
        if [ -d "$l_home" ]; then
            l_mask='0027'
            l_max="$(printf '%o' $(( 0777 & ~$l_mask)) )"
            while read -r l_own l_mode; do
                if [ "$l_user" != "$l_own" ]; then
                    l_output2="$l_output2\n  - User: \"$l_user\" Home \"$l_home\" is owned by: \"$l_own\"\n   - changing ownership to: \"$l_user\"\n"
                    chown "$l_user" "$l_home"
                fi
                if [ $(( $l_mode & $l_mask )) -gt 0 ]; then
                    l_output2="$l_output2\n  - User: \"$l_user\" Home \"$l_home\" is mode: \"$l_mode\" should be mode: \"$l_max\" or more restrictive\n   - removing excess permissions\n"
                    chmod g-w,o-rwx "$l_home"
                fi
            done <<< "$(stat -Lc '%U %#a' "$l_home")"
        else
            l_output2="$l_output2\n  - User: \"$l_user\" Home \"$l_home\" Doesn't exist\n  - Please create a home in accordance with local site policy"
        fi
    done <<< "$(printf '%s\n' "${a_uarr[@]}")"
    if [ -z "$l_output2" ]; then # If l_output2 is empty, we pass
        echo -e " - No modification needed to local interactive users home directories"
    else
        echo -e "\n$l_output2"
    fi
}
```

## References

1. NIST SP 800-53 Rev. 5: AC-3, MP-2

## CIS Controls

- v8: **3.3** Configure Data Access Control Lists
- v7: **14.6** Protect Information through Access Control Lists
