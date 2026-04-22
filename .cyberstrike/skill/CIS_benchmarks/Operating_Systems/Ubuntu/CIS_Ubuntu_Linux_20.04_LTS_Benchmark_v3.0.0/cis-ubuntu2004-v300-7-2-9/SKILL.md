---
name: cis-ubuntu2004-v300-7-2-9
description: "Ensure local interactive user home directories are configured"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, users]
cis_id: "7.2.9"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.2.9 Ensure local interactive user home directories are configured (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

The user home directory is space defined for the particular user to set local environment variables and to store personal files. While the system administrator can establish secure permissions for users' home directories, the users can easily override these. Users can be defined in `/etc/passwd` without a home directory or with a home directory that does not actually exist.

## Rationale

Since the user is accountable for files stored in the user home directory, the user must be the owner of the directory. Group or world-writable user home directories may enable malicious users to steal or modify other users' data or to gain another user's system privileges. If the user's home directory does not exist or is unassigned, the user will be placed in "/" and will not be able to write any files or have local environment variables set.

## Impact

None

## Audit Procedure

### Command Line

Run the following script to Ensure:

- local interactive user home directories exist
- Ensure local interactive users own their home directories
- Ensure local interactive user home directories are mode 750 or more restrictive

```bash
#!/usr/bin/env bash

{
    a_output=() a_output2=() a_exists2=() a_mode2=() a_owner2=()
    l_valid_shells="^$(awk -F\/ '$NF != "nologin" {print}' /etc/shells | sed -rn '/^\//{s,/,\\/,g;p}' | paste -s -d '|' - ))$"
    l_mask='0027'; l_max="$(printf '%o' $(( 0777 & ~$l_mask)) )"
    l_users="$(awk -v pat="$l_valid_shells" -F: '$(NF) ~ pat { print $1 " " $(NF-1) }' /etc/passwd | wc -l)"
    [ "$l_users" -gt 10000 ] && printf '%s\n' "" " ** INFO **" \
    " $l_users Local interactive users found on the system" " This may be a long running check" " **********"
    while IFS=" " read -r l_user l_home; do
        if [ -d "$l_home" ]; then
            while IFS=: read -r l_own l_mode; do
                [ "$l_user" != "$l_own" ] && a_owner2+=(" - User: \"$l_user\" Home \"$l_home\" is owned by: \"$l_own\"")
                [ $(( $l_mode & $l_mask )) -gt 0 ] && a_mode2+=(" - User: \"$l_user\" Home \"$l_home\" is mode: \"$l_mode\" should be mode: \"$l_max\" or more restrictive")
            done <<< "$(stat -Lc '%U:%#a' "$l_home")"
        else
            a_exists2+=(" - User: \"$l_user\" Home Directory: \"$l_home\" Doesn't exist")
        fi
    done <<< "$(awk -v pat="$l_valid_shells" -F: '$(NF) ~ pat { print $1 " " $(NF-1) }' /etc/passwd)"
    [ "${#a_exists2[@]}" -gt 0 ] && a_output2+=("${a_exists2[@]}") || \
    a_output+=(" - All interactive users home directories exist")
    [ "${#a_mode2[@]}" -gt 0 ] && a_output2+=("${a_mode2[@]}") || \
    a_output+=(" - All interactive users home directories are mode \"$l_max\" or more restrictive")
    [ "${#a_owner2[@]}" -gt 0 ] && a_output2+=("${a_owner2[@]}") || \
    a_output+=(" - All interactive users own their home directory")
    if [ "${#a_output2[@]}" -le 0 ]; then
        printf '%s\n' "" "- Audit Result:" " ** PASS **" "${a_output[@]}"
    else
        printf '%s\n' "" "- Audit Result:" " ** FAIL **" " - Reason(s) for audit failure:" "${a_output2[@]}"
        [ "${#a_output[@]}" -gt 0 ] && printf '%s\n' "- Correctly set:" "${a_output[@]}"
    fi
}
```

## Expected Result

PASS -- All interactive users home directories exist, are mode 750 or more restrictive, and are owned by the user.

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
    a_output2=() a_output3=()
    l_valid_shells="^$(awk -F\/ '$NF != "nologin" {print}' /etc/shells | sed -rn '/^\//{s,/,\\/,g;p}' | paste -s -d '|' - ))$"
    l_mask='0027'; l_max="$(printf '%o' $(( 0777 & ~$l_mask)) )"
    l_users="$(awk -v pat="$l_valid_shells" -F: '$(NF) ~ pat { print $1 " " $(NF-1) }' /etc/passwd | wc -l)"
    [ "$l_users" -gt 10000 ] && printf '%s\n' "" " ** INFO **" \
    " $l_users Local interactive users found on the system" " This may be a long running check" " **********"
    while IFS=" " read -r l_user l_home; do
        if [ -d "$l_home" ]; then
            while IFS=: read -r l_own l_mode; do
                if [ "$l_user" != "$l_own" ]; then
                    a_owner2+=(" - User: \"$l_user\" Home \"$l_home\" is owned by: \"$l_own\"" \
                    "   changing owner to: \"$l_user\"") && chown "$l_user" "$l_home"
                fi
                if [ $(( $l_mode & $l_mask )) -gt 0 ]; then
                    a_mode2+=(" - User: \"$l_user\" Home \"$l_home\" is mode: \"$l_mode\"" \
                    "   changing to mode: \"$l_max\" or more restrictive")
                    chmod g-w,o-rwx "$l_home"
                fi
            done <<< "$(stat -Lc '%U:%#a' "$l_home")"
        else
            a_exists2+=(" - User: \"$l_user\" Home Directory: \"$l_home\" Doesn't exist")
        fi
    done <<< "$(awk -v pat="$l_valid_shells" -F: '$(NF) ~ pat { print $1 " " $(NF-1) }' /etc/passwd)"
    [ "${#a_exists2[@]}" -gt 0 ] && a_output2+=("${a_exists2[@]}")
    [ "${#a_mode2[@]}" -gt 0 ] && a_output2+=("${a_mode2[@]}")
    [ "${#a_owner2[@]}" -gt 0 ] && a_output2+=("${a_owner2[@]}")
    if [ "${#a_output2[@]}" -gt 0 ]; then
        printf '%s\n' "" "${a_output2[@]}"
    else
        printf '%s\n' "" "- No changes required"
    fi
}
```

## Default Value

N/A

## References

1. NIST SP 800-53 Revision 5 :: CM-6 b
2. NIST SP 800-53A :: CM-6.1 (iv)

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | X | X | X |
| v7 | 14.6 Protect Information through Access Control Lists | X | X | X |

MITRE ATT&CK Mappings:

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1222, T1222.002 | TA0005 | M1022 |
