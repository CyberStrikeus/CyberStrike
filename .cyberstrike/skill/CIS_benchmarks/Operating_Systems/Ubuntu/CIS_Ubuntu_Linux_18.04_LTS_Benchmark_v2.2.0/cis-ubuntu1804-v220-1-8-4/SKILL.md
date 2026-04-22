---
name: cis-ubuntu1804-v220-1-8-4
description: "Ensure GDM screen locks when the user is idle"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, gdm, gnome, screen-lock, idle, dconf]
cis_id: "1.8.4"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.8.4 Ensure GDM screen locks when the user is idle (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

GNOME Desktop Manager can make the screen lock automatically whenever the user is idle for some amount of time.

- `idle-delay=uint32 {n}` - Number of seconds of inactivity before the screen goes blank
- `lock-delay=uint32 {n}` - Number of seconds after the screen is blank before locking the screen

Example key file:

```
# Specify the dconf path
[org/gnome/desktop/session]

# Number of seconds of inactivity before the screen goes blank
# Set to 0 seconds if you want to deactivate the screensaver.
idle-delay=uint32 900

# Specify the dconf path
[org/gnome/desktop/screensaver]

# Number of seconds after the screen is blank before locking the screen
lock-delay=uint32 5
```

## Rationale

Setting a lock-out value reduces the window of opportunity for unauthorized user access to another user's session that has been left unattended.

## Audit Procedure

### Command Line

Run the following script to verify that the screen locks when the user is idle:

```bash
#!/usr/bin/env bash

{
    # Check if GNOME Desktop Manager is installed. If package isn't installed, recommendation is Not Applicable\n
    # determine system's package manager
    l_pkgoutput=""
    if command -v dpkg-query > /dev/null 2>&1; then
        l_pq="dpkg-query -s"
    elif command -v rpm > /dev/null 2>&1; then
        l_pq="rpm -q"
    fi
    # Check if GDM is installed
    l_pcl="gdm gdm3" # Space separated list of packages to check
    for l_pn in $l_pcl; do
        $l_pq "$l_pn" > /dev/null 2>&1 && l_pkgoutput="$l_pkgoutput\n - Package: \"$l_pn\" exists on the system\n - checking configuration"
    done
    # Check configuration (If applicable)
    if [ -n "$l_pkgoutput" ]; then
        l_output="" l_output2=""
        l_idmv="900" # Set for max value for idle-delay in seconds
        l_ldmv="5" # Set for max value for lock-delay in seconds
        # Look for idle-delay to determine profile in use, needed for remaining tests
        l_kfile="$(grep -Psril '^\h*idle-delay\h*=\h*uint32\h+\d+\b' /etc/dconf/db/*/) " # Determine file containing idle-delay key
        if [ -n "$l_kfile" ]; then
            # set profile name (This is the name of a dconf database)
            l_profile="$(awk -F'/' '{split($(NF-1),a,".");print a[1]}' <<< "$l_kfile")" #Set the key profile name
            l_pdbdir="/etc/dconf/db/$l_profile.d" # Set the key file dconf db directory
            # Confirm that idle-delay exists, includes uint32, and value is between 1 and max value for idle-delay
            l_idv="$(awk -F 'uint32' '/idle-delay/{print $2}' "$l_kfile" | xargs)"
            if [ -n "$l_idv" ]; then
                [ "$l_idv" -gt "0" -a "$l_idv" -le "$l_idmv" ] && l_output="$l_output\n - The \"idle-delay\" option is set to \"$l_idv\" seconds in \"$l_kfile\""
                [ "$l_idv" = "" ] && l_output2="$l_output2\n - The \"idle-delay\" option is set to \"$l_idv\" (disabled) in \"$l_kfile\""
                [ "$l_idv" -gt "$l_idmv" ] && l_output2="$l_output2\n - The \"idle-delay\" option is set to \"$l_idv\" seconds (greater than $l_idmv) in \"$l_kfile\""
            else
                l_output2="$l_output2\n - The \"idle-delay\" option is not set in \"$l_kfile\""
            fi
            # Confirm that lock-delay exists, includes uint32, and value is between 0 and max value for lock-delay
            l_ldv="$(awk -F 'uint32' '/lock-delay/{print $2}' "$l_kfile" | xargs)"
            if [ -n "$l_ldv" ]; then
                [ "$l_ldv" -ge "0" -a "$l_ldv" -le "$l_ldmv" ] && l_output="$l_output\n - The \"lock-delay\" option is set to \"$l_ldv\" seconds in \"$l_kfile\""
                [ "$l_ldv" -gt "$l_ldmv" ] && l_output2="$l_output2\n - The \"lock-delay\" option is set to \"$l_ldv\" seconds (greater than $l_ldmv) in \"$l_kfile\""
            else
                l_output2="$l_output2\n - The \"lock-delay\" option is not set in \"$l_kfile\""
            fi
            # Confirm that dconf profile exists
            if grep -Psq "^\h*system-db:$l_profile" /etc/dconf/profile/*; then
                l_output="$l_output\n - The \"$l_profile\" profile exists"
            else
                l_output2="$l_output2\n - The \"$l_profile\" doesn't exist"
            fi
            # Confirm that dconf profile database file exists
            if [ -f "/etc/dconf/db/$l_profile" ]; then
                l_output="$l_output\n - The \"$l_profile\" profile exists in the dconf database"
            else
                l_output2="$l_output2\n - The \"$l_profile\" profile doesn't exist in the dconf database"
            fi
        else
            l_output2="$l_output2\n - The \"idle-delay\" option doesn't exist, remaining tests skipped"
        fi
    else
        l_output="$l_output\n - GNOME Desktop Manager package is not installed on the system\n  - Recommendation is not applicable"
    fi
    # Report results. If no failures output in l_output2, we pass
    [ -n "$l_pkgoutput" ] && echo -e "\n$l_pkgoutput"
    if [ -z "$l_output2" ]; then
        echo -e "\n- Audit Result:\n  ** PASS **\n$l_output\n"
    else
        echo -e "\n- Audit Result:\n  ** FAIL **\n - Reason(s) for audit failure:\n$l_output2\n"
        [ -n "$l_output" ] && echo -e "\n- Correctly set:\n$l_output\n"
    fi
}
```

## Expected Result

- `idle-delay=uint32` Should be 900 seconds (15 minutes) or less, not `0` (disabled) and follow local site policy
- `lock-delay=uint32` should be 5 seconds or less and follow local site policy

## Remediation

### Command Line

Create or edit a file in the `/etc/dconf/profile/` and verify it includes the following:

```
user-db:user
system-db:{NAME_OF_DCONF_DATABASE}
```

Note: `local` is the name of a dconf database used in the examples.

Example:

```bash
echo -e '\nuser-db:user\nsystem-db:local' >> /etc/dconf/profile/user
```

Create the directory `/etc/dconf/db/{NAME_OF_DCONF_DATABASE}.d/` if it doesn't already exist:

Example:

```bash
mkdir /etc/dconf/db/local.d
```

Create the key file `/etc/dconf/db/{NAME_OF_DCONF_DATABASE}.d/{FILE_NAME}` to provide information for the `{NAME_OF_DCONF_DATABASE}` database:

Example script:

```bash
#!/usr/bin/env bash

{
    l_key_file="/etc/dconf/db/local.d/00-screensaver"
    l_idmv="900" # Set max value for idle-delay in seconds (between 1 and 900)
    l_ldmv="5" # Set max value for lock-delay in seconds (between 0 and 5)
    {
        echo '# Specify the dconf path'
        echo '[org/gnome/desktop/session]'
        echo ''
        echo '# Number of seconds of inactivity before the screen goes blank'
        echo '# Set to 0 seconds if you want to deactivate the screensaver.'
        echo "idle-delay=uint32 $l_idmv"
        echo ''
        echo '# Specify the dconf path'
        echo '[org/gnome/desktop/screensaver]'
        echo ''
        echo '# Number of seconds after the screen is blank before locking the screen'
        echo "lock-delay=uint32 $l_ldmv"
    } > "$l_key_file"
}
```

Note: You must include the uint32 along with the integer key values as shown.

Run the following command to update the system databases:

```bash
dconf update
```

Note: Users must log out and back in again before the system-wide settings take effect.

## References

1. https://help.gnome.org/admin/system-admin-guide/stable/desktop-lockscreen.html.en
2. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.3 Configure Automatic Session Locking on Enterprise Assets | X | X | X |
| v7 | 16.11 Lock Workstation Sessions After Inactivity | X | X | X |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1461 | TA0027 | M1012 |
