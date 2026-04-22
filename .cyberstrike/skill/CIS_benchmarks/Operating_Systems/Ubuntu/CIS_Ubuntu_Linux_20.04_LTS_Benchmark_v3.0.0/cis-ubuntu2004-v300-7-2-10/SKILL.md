---
name: cis-ubuntu2004-v300-7-2-10
description: "Ensure local interactive user dot files access is configured"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, users]
cis_id: "7.2.10"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.2.10 Ensure local interactive user dot files access is configured (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

While the system administrator can establish secure permissions for users' "dot" files, the users can easily override these.

- `.forward` file specifies an email address to forward the user's mail to.
- `.rhost` file provides the "remote authentication" database for the rcp, rlogin, and rsh commands and the rcmd() function. These files bypass the standard password-based user authentication mechanism. They specify remote hosts and users that are considered trusted (i.e. are allowed to access the local system without supplying a password)
- `.netrc` file contains data for logging into a remote host or passing authentication to an API.
- `.bash_history` file keeps track of the user's commands.

## Rationale

User configuration files with excessive or incorrect access may enable malicious users to steal or modify other users' data or to gain another user's system privileges.

## Impact

None

## Audit Procedure

### Command Line

Run the following script to verify local interactive user dot files:

- Don't include `.forward`, `.rhost`, or `.netrc` files
- Are mode 0644 or more restrictive
- Are owned by the local interactive user
- Are group owned by the user's primary group
- `.bash_history` is mode 0600 or more restrictive

Note: If a `.netrc` file is required, and follows local site policy, it should be mode `0600` or more restrictive.

```bash
#!/usr/bin/env bash

{
    a_output2=(); a_output3=()
    l_maxsize="1000" # Maximum number of local interactive users before warning (Default 1,000)
    l_valid_shells="^$(awk -F\/ '$NF != "nologin" {print}' /etc/shells | sed -rn '/^\//{s,/,\\/,g;p}' | paste -s -d '|' - ))$"
    a_user_and_home=() # Create array with local users and their home directories
    while read -r l_local_user l_local_user_home; do # Populate array with users and user home location
        [[ -n "$l_local_user" && -n "$l_local_user_home" ]] &&
        a_user_and_home+=("$l_local_user:$l_local_user_home")
    done <<< "$(awk -v pat="$l_valid_shells" -F: '$(NF) ~ pat { print $1 " " $(NF-1) }' /etc/passwd)"
    [ "${#a_user_and_home[@]}" -gt "$l_maxsize" ] && printf '%s\n' "" " ** INFO **" \
    " - \"$l_asize\" Local interactive users found on the system" \
    " - This may be a long running check" ""
    file_access_chk()
    {
        a_access_out=()
        l_max="$(printf '%o' $(( 0777 & ~$l_mask)) )"
        if [ $(( $l_mode & $l_mask )) -gt 0 ]; then
            a_access_out+=(" - File: \"$l_hdfile\" is mode: \"$l_mode\" and should be mode: \"$l_max\" or more restrictive")
        fi
        if [[ ! "$l_owner" =~ ($l_user) ]]; then
            a_access_out+=(" - File: \"$l_hdfile\" owned by: \"$l_owner\" and should be owned by \"${l_user//|/ or }\"")
        fi
        if [[ ! "$l_gowner" =~ ($l_group) ]]; then
            a_access_out+=(" - File: \"$l_hdfile\" group owned by: \"$l_gowner\" and should be group owned by \"${l_group//|/ or }\"")
        fi
    }
    while IFS=: read -r l_user l_home; do
        a_dot_file=(); a_netrc=(); a_netrc_warn=(); a_bhout=(); a_hdirout=()
        if [ -d "$l_home" ]; then
            l_group="$(id -gn "$l_user" | xargs)";l_group="${l_group// |/}"
            while IFS= read -r -d $'\0' l_hdfile; do
                while read -r l_mode l_owner l_gowner; do
                    case "$(basename "$l_hdfile")" in
                        .forward | .rhost )
                            a_dot_file+=(" - File: \"$l_hdfile\" exists") ;;
                        .netrc )
                            l_mask='0177'; file_access_chk
                            if [ "${#a_access_out[@]}" -gt 0 ]; then
                                a_netrc+=("${a_access_out[@]}")
                            else
                                a_netrc_warn+=(" - File: \"$l_hdfile\" exists")
                            fi ;;
                        .bash_history )
                            l_mask='0177'; file_access_chk
                            [ "${#a_access_out[@]}" -gt 0 ] && a_bhout+=("${a_access_out[@]}") ;;
                        * )
                            l_mask='0133'; file_access_chk
                            [ "${#a_access_out[@]}" -gt 0 ] && a_hdirout+=("${a_access_out[@]}") ;;
                    esac
                done < <(stat -Lc '%#a %U %G' "$l_hdfile")
            done < <(find "$l_home" -xdev -type f -name '.*' -print0)
        fi
        if [[ "${#a_dot_file[@]}" -gt 0 || "${#a_netrc[@]}" -gt 0 || "${#a_bhout[@]}" -gt 0 || "${#a_hdirout[@]}" -gt 0 ]]; then
            a_output2+=(" - User: \"$l_user\" Home Directory: \"$l_home\"" "${a_dot_file[@]}" "${a_netrc[@]}" "${a_bhout[@]}" "${a_hdirout[@]}")
        fi
        [ "${#a_netrc_warn[@]}" -gt 0 ] && a_output3+=(" - User: \"$l_user\" Home Directory: \"$l_home\"" "${a_netrc_warn[@]}")
    done <<< "$(printf '%s\n' "${a_user_and_home[@]}")"
    if [ "${#a_output2[@]}" -le 0 ]; then
        [ "${#a_output3[@]}" -gt 0 ] && printf '%s\n' " ** WARNING **" "${a_output3[@]}"
        printf '%s\n' "" "- Audit Result:" " ** PASS **"
    else
        printf '%s\n' "" "- Audit Result:" " ** FAIL **" " - * Reasons for audit failure * :" "${a_output2[@]}" ""
        [ "${#a_output3[@]}" -gt 0 ] && printf '%s\n' " ** WARNING **" "${a_output3[@]}"
    fi
}
```

## Expected Result

PASS -- All local interactive user dot files are properly configured.

## Remediation

### Command Line

Making global modifications to users' files without alerting the user community can result in unexpected outages and unhappy users. Therefore, it is recommended that a monitoring policy be established to report user dot file permissions and determine the action to be taken in accordance with site policy.

The following script will:

- remove excessive permissions on `dot` files within interactive users' home directories
- change ownership of `dot` files within interactive users' home directories to the user
- change group ownership of `dot` files within interactive users' home directories to the user's primary group
- list `.forward` and `.rhost` files to be investigated and manually deleted

```bash
#!/usr/bin/env bash

{
    a_output2=(); a_output3=()
    l_maxsize="1000" # Maximum number of local interactive users before warning (Default 1,000)
    l_valid_shells="^$(awk -F\/ '$NF != "nologin" {print}' /etc/shells | sed -rn '/^\//{s,/,\\/,g;p}' | paste -s -d '|' - ))$"
    a_user_and_home=() # Create array with local users and their home directories
    while read -r l_local_user l_local_user_home; do # Populate array with users and user home location
        [[ -n "$l_local_user" && -n "$l_local_user_home" ]] &&
        a_user_and_home+=("$l_local_user:$l_local_user_home")
    done <<< "$(awk -v pat="$l_valid_shells" -F: '$(NF) ~ pat { print $1 " " $(NF-1) }' /etc/passwd)"
    [ "${#a_user_and_home[@]}" -gt "$l_maxsize" ] && printf '%s\n' "" " ** INFO **" \
    " - \"$l_asize\" Local interactive users found on the system" \
    " - This may be a long running check" ""
    file_access_fix()
    {
        a_access_out=()
        l_max="$(printf '%o' $(( 0777 & ~$l_mask)) )"
        if [ $(( $l_mode & $l_mask )) -gt 0 ]; then
            printf '%s\n' "" " - File: \"$l_hdfile\" is mode: \"$l_mode\" and should be mode: \"$l_max\" or more restrictive" \
            "   Updating file: \"$l_hdfile\" to be mode: \"$l_max\" or more restrictive"
            chmod "$l_change" "$l_hdfile"
        fi
        if [[ ! "$l_owner" =~ ($l_user) ]]; then
            printf '%s\n' "" " - File: \"$l_hdfile\" owned by: \"$l_owner\" and should be owned by \"${l_user//|/ or }\""
            "   Updating file: \"$l_hdfile\" to be owned by \"${l_user//|/ or }\""
            chown "$l_user" "$l_hdfile"
        fi
        if [[ ! "$l_gowner" =~ ($l_group) ]]; then
            printf '%s\n' "" " - File: \"$l_hdfile\" group owned by: \"$l_gowner\" and should be group owned by \"${l_group//|/ or }\""
            "   Updating file: \"$l_hdfile\" to be group owned by \"${l_group//|/ or }\""
            chgrp "$l_group" "$l_hdfile"
        fi
    }
    while IFS=: read -r l_user l_home; do
        a_dot_file=(); a_netrc=(); a_netrc_warn=(); a_bhout=(); a_hdirout=()
        if [ -d "$l_home" ]; then
            l_group="$(id -gn "$l_user" | xargs)";l_group="${l_group// |/}"
            while IFS= read -r -d $'\0' l_hdfile; do
                while read -r l_mode l_owner l_gowner; do
                    case "$(basename "$l_hdfile")" in
                        .forward | .rhost )
                            a_dot_file+=(" - File: \"$l_hdfile\" exists" " Please review and manually delete this file") ;;
                        .netrc )
                            l_mask='0177'; l_change="u-x,go-rwx"; file_access_fix
                            a_netrc_warn+=(" - File: \"$l_hdfile\" exists") ;;
                        .bash_history )
                            l_mask='0177'; l_change="u-x,go-rwx"; file_access_fix ;;
                        * )
                            l_mask='0133'; l_change="u-x,go-wx"; file_access_fix ;;
                    esac
                done < <(stat -Lc '%#a %U %G' "$l_hdfile")
            done < <(find "$l_home" -xdev -type f -name '.*' -print0)
        fi
        [ "${#a_dot_file[@]}" -gt 0 ] && a_output2+=(" - User: \"$l_user\" Home Directory: \"$l_home\"" "${a_dot_file[@]}")
        [ "${#a_netrc_warn[@]}" -gt 0 ] && a_output3+=(" - User: \"$l_user\" Home Directory: \"$l_home\"" "${a_netrc_warn[@]}")
    done <<< "$(printf '%s\n' "${a_user_and_home[@]}")"
    [ "${#a_output3[@]}" -gt 0 ] && printf '%s\n' " ** WARNING **" "${a_output3[@]}" ""
    [ "${#a_output2[@]}" -gt 0 ] && printf '%s\n' "" "${a_output2[@]}"
}
```

## Default Value

N/A

## References

1. NIST SP 800-53 Rev. 5: AC-3, MP-2

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.3 Configure Data Access Control Lists | X | X | X |
| v7 | 14.6 Protect Information through Access Control Lists | X | X | X |

MITRE ATT&CK Mappings:

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1222, T1222.002 | TA0005 | M1022 |
