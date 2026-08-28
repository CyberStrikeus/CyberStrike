---
name: cis-ubuntu1804-v220-6-2-10
description: "Ensure local interactive user dot files access is configured"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, users]
cis_id: "6.2.10"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.10 Ensure local interactive user dot files access is configured (Automated)

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

## Audit Procedure

### Command Line

Run the following script to verify local interactive user dot files:

- Don't include `.forward`, `.rhost`, or `.netrc` files
- Are mode 0644 or more restrictive
- Are owned by the local interactive user
- Are group owned by the user's primary group
- `.bash_history` is mode 0600 or more restrictive

**Note:** If a `.netrc` file is required, and follows local site policy, it should be mode `0600` or more restrictive.

```bash
#!/usr/bin/env bash

{
    l_output="" l_output2="" l_output3=""
    l_bf="" l_df="" l_nf="" l_hf=""
    l_valid_shells="^$($ awk -F\/ '$NF != "nologin" {print}' /etc/shells | sed -rn '/^\//{s,/,\\/,g;p}' | paste -s -d '|' - ))$"
    unset a_uarr && a_uarr=() # Clear and initialize array
    while read -r l_epu l_eph; do # Populate array with users and user home location
        [[ -n "$l_epu" && -n "$l_eph" ]] && a_uarr+=("$l_epu $l_eph")
    done <<< "$(awk -v pat="$l_valid_shells" -F: '$(NF) ~ pat { print $1 " " $(NF-1) }' /etc/passwd)"
    l_asize="${#a_uarr[@]}" # Here if we want to look at number of users before proceeding
    l_maxsize="1000" # Maximum number of local interactive users before warning (Default 1,000)
    [ "$l_asize " -gt "$l_maxsize" ] && echo -e "\n  ** INFO **\n  - \"$l_asize\" Local interactive users found on the system\n  - This may be a long running check\n"
    file_access_chk()
    {
        l_facout2=""
        l_max="$(printf '%o' $(( 0777 & ~$l_mask)) )"
        if [ $(( $l_mode & $l_mask )) -gt 0 ]; then
            l_facout2="$l_facout2\n  - File: \"$l_hdfile\" is mode: \"$l_mode\" and should be mode: \"$l_max\" or more restrictive"
        fi
        if [[ ! "$l_owner" =~ ($l_user) ]]; then
            l_facout2="$l_facout2\n  - File: \"$l_hdfile\" owned by: \"$l_owner\" and should be owned by \"${l_user//|/ or }\""
        fi
        if [[ ! "$l_gowner" =~ ($l_group) ]]; then
            l_facout2="$l_facout2\n  - File: \"$l_hdfile\" group owned by: \"$l_gowner\" and should be group owned by \"${l_group//|/ or }\""
        fi
    }
    while read -r l_user l_home; do
        l_fe="" l_nout2="" l_nout3="" l_dfout2="" l_hdout2="" l_bhout2=""
        if [ -d "$l_home" ]; then
            l_group="$(id -gn "$l_user" | xargs)"
            l_group="${l_group// /|}"
            while IFS= read -r -d $'\0' l_hdfile; do
                while read -r l_mode l_owner l_gowner; do
                    case "$(basename "$l_hdfile")" in
                        .forward | .rhost )
                            l_fe="y" && l_bf="y"
                            l_dfout2="$l_dfout2\n  - File: \"$l_hdfile\" exists" ;;
                        .netrc )
                            l_mask='0177'
                            file_access_chk
                            if [ -n "$l_facout2" ]; then
                                l_fe="y" && l_nf="y"
                                l_nout2="$l_facout2"
                            else
                                l_nout3="  - File: \"$l_hdfile\" exists"
                            fi ;;
                        .bash_history )
                            l_mask='0177'
                            file_access_chk
                            if [ -n "$l_facout2" ]; then
                                l_fe="y" && l_hf="y"
                                l_bhout2="$l_facout2"
                            fi ;;
                        * )
                            l_mask='0133'
                            file_access_chk
                            if [ -n "$l_facout2" ]; then
                                l_fe="y" && l_df="y"
                                l_hdout2="$l_facout2"
                            fi ;;
                    esac
                done <<< "$(stat -Lc '%#a %U %G' "$l_hdfile")"
            done < <(find "$l_home" -xdev -type f -name '.*' -print0)
        fi
        if [ "$l_fe" = "y" ]; then
            l_output2="$l_output2\n  - User: \"$l_user\" Home Directory: \"$l_home\""
            [ -n "$l_dfout2" ] && l_output2="$l_output2$l_dfout2"
            [ -n "$l_nout2" ] && l_output2="$l_output2$l_nout2"
            [ -n "$l_bhout2" ] && l_output2="$l_output2$l_bhout2"
            [ -n "$l_hdout2" ] && l_output2="$l_output2$l_hdout2"
        fi
        [ -n "$l_nout3" ] && l_output3="$l_output3\n  - User: \"$l_user\" Home Directory: \"$l_home\"\n$l_nout3"
    done <<< "$(printf '%s\n' "${a_uarr[@]}")"
    unset a_uarr # Remove array
    [ -n "$l_output3" ] && l_output3=" - ** Warning **\n  - \".netrc\" files should be removed unless deemed necessary\n   and in accordance with local site policy:$l_output3"
    [ -z "$l_bf" ] && l_output="$l_output\n   - \".forward\" or \".rhost\" files"
    [ -z "$l_nf" ] && l_output="$l_output\n   - \".netrc\" files with incorrect access configured"
    [ -z "$l_hf" ] && l_output="$l_output\n   - \".bash_history\" files with incorrect access configured"
    [ -z "$l_df" ] && l_output="$l_output\n   - \"dot\" files with incorrect access configured"
    [ -n "$l_output" ] && l_output=" - No local interactive users home directories contain:$l_output"
    if [ -z "$l_output2" ]; then # If l_output2 is empty, we pass
        echo -e "\n- Audit Result:\n  ** PASS **\n - * Correctly configured * :\n$l_output\n"
        echo -e "$l_output3\n"
    else
        echo -e "\n- Audit Result:\n  ** FAIL **\n - * Reasons for audit failure * :\n$l_output2\n"
        echo -e "$l_output3"
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

Making global modifications to users' files without alerting the user community can result in unexpected outages and unhappy users. Therefore, it is recommended that a monitoring policy be established to report user dot file permissions and determine the action to be taken in accordance with site policy.

The following script will:

- remove excessive permissions on `dot` files within interactive users' home directories
- change ownership of `dot` files within interactive users' home directories to the user
- change group ownership of `dot` files within interactive users' home directories to the user's primary group
- list `.forward` and `.rhost` files to be investigated and manually deleted

```bash
#!/usr/bin/env bash

{
    l_valid_shells="^$($ awk -F\/ '$NF != "nologin" {print}' /etc/shells | sed -rn '/^\//{s,/,\\/,g;p}' | paste -s -d '|' - ))$"
    unset a_uarr && a_uarr=() # Clear and initialize array
    while read -r l_epu l_eph; do # Populate array with users and user home location
        [[ -n "$l_epu" && -n "$l_eph" ]] && a_uarr+=("$l_epu $l_eph")
    done <<< "$(awk -v pat="$l_valid_shells" -F: '$(NF) ~ pat { print $1 " " $(NF-1) }' /etc/passwd)"
    l_asize="${#a_uarr[@]}" # Here if we want to look at number of users before proceeding
    l_maxsize="1000" # Maximum number of local interactive users before warning (Default 1,000)
    [ "$l_asize " -gt "$l_maxsize" ] && echo -e "\n  ** INFO **\n  - \"$l_asize\" Local interactive users found on the system\n  - This may be a long running check\n"
    file_access_fix()
    {
        l_facout2=""
        l_max="$(printf '%o' $(( 0777 & ~$l_mask)) )"
        if [ $(( $l_mode & $l_mask )) -gt 0 ]; then
            echo -e "  - File: \"$l_hdfile\" is mode: \"$l_mode\" and should be mode: \"$l_max\" or more restrictive\n   - Changing to mode \"$l_max\""
            chmod "$l_chp" "$l_hdfile"
        fi
        if [[ ! "$l_owner" =~ ($l_user) ]]; then
            echo -e "  - File: \"$l_hdfile\" owned by: \"$l_owner\" and should be owned by \"${l_user//|/ or }\"\n   - Changing ownership to \"$l_user\""
            chown "$l_user" "$l_hdfile"
        fi
        if [[ ! "$l_gowner" =~ ($l_group) ]]; then
            echo -e "  - File: \"$l_hdfile\" group owned by: \"$l_gowner\" and should be group owned by \"${l_group//|/ or }\"\n   - Changing group ownership to \"$l_group\""
            chgrp "$l_group" "$l_hdfile"
        fi
    }
    while read -r l_user l_home; do
        if [ -d "$l_home" ]; then
            echo -e "\n - Checking user: \"$l_user\" home directory: \"$l_home\""
            l_group="$(id -gn "$l_user" | xargs)"
            l_group="${l_group// /|}"
            while IFS= read -r -d $'\0' l_hdfile; do
                while read -r l_mode l_owner l_gowner; do
                    case "$(basename "$l_hdfile")" in
                        .forward | .rhost )
                            echo -e "  - File: \"$l_hdfile\" exists\n  - Please investigate and manually delete \"$l_hdfile\""
                            ;;
                        .netrc )
                            l_mask='0177'
                            l_chp="u-x,go-rwx"
                            file_access_fix ;;
                        .bash_history )
                            l_mask='0177'
                            l_chp="u-x,go-rwx"
                            file_access_fix ;;
                        * )
                            l_mask='0133'
                            l_chp="u-x,go-wx"
                            file_access_fix ;;
                    esac
                done <<< "$(stat -Lc '%#a %U %G' "$l_hdfile")"
            done < <(find "$l_home" -xdev -type f -name '.*' -print0)
        fi
    done <<< "$(printf '%s\n' "${a_uarr[@]}")"
    unset a_uarr # Remove array
}
```

## References

1. NIST SP 800-53 Rev. 5: AC-3, MP-2

## CIS Controls

- v8: **3.3** Configure Data Access Control Lists
- v7: **14.6** Protect Information through Access Control Lists
