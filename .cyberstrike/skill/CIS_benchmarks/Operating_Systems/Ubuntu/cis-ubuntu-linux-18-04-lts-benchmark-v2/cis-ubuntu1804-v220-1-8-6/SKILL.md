---
name: cis-ubuntu1804-v220-1-8-6
description: "Ensure GDM automatic mounting of removable media is disabled"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, gdm, gnome, automount, removable-media, dconf]
cis_id: "1.8.6"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.8.6 Ensure GDM automatic mounting of removable media is disabled (Automated)

## Profile Applicability

- Level 1 - Server
- Level 2 - Workstation

## Description

By default GNOME automatically mounts removable media when inserted as a convenience to the user.

## Rationale

With automounting enabled anyone with physical access could attach a USB drive or disc and have its contents available in system even if they lacked permissions to mount it themselves.

## Impact

The use of portable hard drives is very common for workstation users. If your organization allows the use of portable storage or media on workstations and physical access controls to workstations is considered adequate there is little value add in turning off automounting.

## Audit Procedure

### Command Line

Run the following script to verify automatic mounting is disabled:

```bash
#!/usr/bin/env bash

{
    l_pkgoutput="" l_output="" l_output2=""
    # Check if GNOME Desktop Manager is installed. If package isn't installed, recommendation is Not Applicable\n
    # determine system's package manager
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
        echo -e "$l_pkgoutput"
        # Look for existing settings and set variables if they exist
        l_kfile="$(grep -Prils -- '^\h*automount\b' /etc/dconf/db/*.d)"
        l_kfile2="$(grep -Prils -- '^\h*automount-open\b' /etc/dconf/db/*.d)"
        # Set profile name based on dconf db directory ({PROFILE_NAME}.d)
        if [ -f "$l_kfile" ]; then
            l_gpname="$(awk -F\/ '{split($(NF-1),a,".");print a[1]}' <<< "$l_kfile")"
        elif [ -f "$l_kfile2" ]; then
            l_gpname="$(awk -F\/ '{split($(NF-1),a,".");print a[1]}' <<< "$l_kfile2")"
        fi
        # If the profile name exist, continue checks
        if [ -n "$l_gpname" ]; then
            l_gpdir="/etc/dconf/db/$l_gpname.d"
            # Check if profile file exists
            if grep -Pq -- "^\h*system-db:$l_gpname\b" /etc/dconf/profile/*; then
                l_output="$l_output\n - dconf database profile file \"$(grep -Pl -- "^\h*system-db:$l_gpname\b" /etc/dconf/profile/*)\" exists"
            else
                l_output2="$l_output2\n - dconf database profile isn't set"
            fi
            # Check if the dconf database file exists
            if [ -f "/etc/dconf/db/$l_gpname" ]; then
                l_output="$l_output\n - The dconf database \"$l_gpname\" exists"
            else
                l_output2="$l_output2\n - The dconf database \"$l_gpname\" doesn't exist"
            fi
            # check if the dconf database directory exists
            if [ -d "$l_gpdir" ]; then
                l_output="$l_output\n - The dconf directory \"$l_gpdir\" exitst"
            else
                l_output2="$l_output2\n - The dconf directory \"$l_gpdir\" doesn't exist"
            fi
            # check automount setting
            if grep -Pqrs -- '^\h*automount\h*=\h*false\b' "$l_kfile"; then
                l_output="$l_output\n - \"automount\" is set to false in: \"$l_kfile\""
            else
                l_output2="$l_output2\n - \"automount\" is not set correctly"
            fi
            # check automount-open setting
            if grep -Pqs -- '^\h*automount-open\h*=\h*false\b' "$l_kfile2"; then
                l_output="$l_output\n - \"automount-open\" is set to false in: \"$l_kfile2\""
            else
                l_output2="$l_output2\n - \"automount-open\" is not set correctly"
            fi
        else
            # Settings don't exist. Nothing further to check
            l_output2="$l_output2\n - neither \"automount\" or \"automount-open\" is set"
        fi
    else
        l_output="$l_output\n - GNOME Desktop Manager package is not installed on the system\n  - Recommendation is not applicable"
    fi
    # Report results. If no failures output in l_output2, we pass
    if [ -z "$l_output2" ]; then
        echo -e "\n- Audit Result:\n  ** PASS **\n$l_output\n"
    else
        echo -e "\n- Audit Result:\n  ** FAIL **\n - Reason(s) for audit failure:\n$l_output2\n"
        [ -n "$l_output" ] && echo -e "\n- Correctly set:\n$l_output\n"
    fi
}
```

## Remediation

### Command Line

Run the following script to disable automatic mounting of media for all GNOME users:

```bash
#!/usr/bin/env bash

{
    l_pkgoutput="" l_output="" l_output2=""
    l_gpname="local" # Set to desired dconf profile name (default is local)
    # Check if GNOME Desktop Manager is installed. If package isn't installed, recommendation is Not Applicable\n
    # determine system's package manager
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
    echo -e "$l_packageout"
    # Check configuration (If applicable)
    if [ -n "$l_pkgoutput" ]; then
        echo -e "$l_pkgoutput"
        # Look for existing settings and set variables if they exist
        l_kfile="$(grep -Prils -- '^\h*automount\b' /etc/dconf/db/*.d)"
        l_kfile2="$(grep -Prils -- '^\h*automount-open\b' /etc/dconf/db/*.d)"
        # Set profile name based on dconf db directory ({PROFILE_NAME}.d)
        if [ -f "$l_kfile" ]; then
            l_gpname="$(awk -F\/ '{split($(NF-1),a,".");print a[1]}' <<< "$l_kfile")"
            echo " - updating dconf profile name to \"$l_gpname\""
        elif [ -f "$l_kfile2" ]; then
            l_gpname="$(awk -F\/ '{split($(NF-1),a,".");print a[1]}' <<< "$l_kfile2")"
            echo " - updating dconf profile name to \"$l_gpname\""
        fi
        # check for consistency (Clean up configuration if needed)
        if [ -f "$l_kfile" ] && [ "$(awk -F\/ '{split($(NF-1),a,".");print a[1]}' <<< "$l_kfile")" != "$l_gpname" ]; then
            sed -ri "/^\s*automount\s*=/s/^/#/ " "$l_kfile"
            l_kfile="/etc/dconf/db/$l_gpname.d/00-media-automount"
        fi
        if [ -f "$l_kfile2" ] && [ "$(awk -F\/ '{split($(NF-1),a,".");print a[1]}' <<< "$l_kfile2")" != "$l_gpname" ]; then
            sed -ri "/^\s*automount-open\s*=/s/^/#/ " "$l_kfile2"
            l_kfile2="/etc/dconf/db/$l_gpname.d/00-media-automount"
        fi
        [ -z "$l_kfile" ] && l_kfile="/etc/dconf/db/$l_gpname.d/00-media-automount"
        # Check if profile file exists
        if grep -Pq -- "^\h*system-db:$l_gpname\b" /etc/dconf/profile/*; then
            echo -e "\n - dconf database profile exists in: \"$(grep -Pl -- "^\h*system-db:$l_gpname\b" /etc/dconf/profile/*)\""
        else
            [ ! -f "/etc/dconf/profile/user" ] && l_gpfile="/etc/dconf/profile/user" || l_gpfile="/etc/dconf/profile/user2"
            echo -e " - creating dconf database profile"
            {
                echo -e "\nuser-db:user"
                echo "system-db:$l_gpname"
            } >> "$l_gpfile"
        fi
        # create dconf directory if it doesn't exists
        l_gpdir="/etc/dconf/db/$l_gpname.d"
        if [ -d "$l_gpdir" ]; then
            echo " - The dconf database directory \"$l_gpdir\" exists"
        else
            echo " - creating dconf database directory \"$l_gpdir\""
            mkdir "$l_gpdir"
        fi
        # check automount-open setting
        if grep -Pqs -- '^\h*automount-open\h*=\h*false\b' "$l_kfile"; then
            echo " - \"automount-open\" is set to false in: \"$l_kfile\""
        else
            echo " - creating \"automount-open\" entry in \"$l_kfile\""
            ! grep -Psq -- '^\h*\[org\/gnome\/desktop\/media-handling\]\b' "$l_kfile" && echo '[org/gnome/desktop/media-handling]' >> "$l_kfile"
            sed -ri '/^\s*\[org\/gnome\/desktop\/media-handling\]/a \\nautomount-open=false' "$l_kfile"
        fi
        # check automount setting
        if grep -Pqs -- '^\h*automount\h*=\h*false\b' "$l_kfile"; then
            echo " - \"automount\" is set to false in: \"$l_kfile\""
        else
            echo " - creating \"automount\" entry in \"$l_kfile\""
            ! grep -Psq -- '^\h*\[org\/gnome\/desktop\/media-handling\]\b' "$l_kfile" && echo '[org/gnome/desktop/media-handling]' >> "$l_kfile"
            sed -ri '/^\s*\[org\/gnome\/desktop\/media-handling\]/a \\nautomount=false' "$l_kfile"
        fi
    else
        echo -e "\n - GNOME Desktop Manager package is not installed on the system\n  - Recommendation is not applicable"
    fi
    # update dconf database
    dconf update
}
```

OR

Run the following command to uninstall the GNOME desktop Manager package:

```bash
apt purge gdm3
```

## References

1. https://access.redhat.com/solutions/20107
2. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 10.3 Disable Autorun and Autoplay for Removable Media | X    | X    | X    |
| v7               | 8.5 Configure Devices Not To Auto-run Content         | X    | X    | X    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1091, T1091.000            | TA0008  | M1042       |
