---
name: cis-ubuntu1804-v220-1-8-9
description: "Ensure GDM autorun-never is not overridden"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, gdm, gnome, autorun-never, lockdown, dconf]
cis_id: "1.8.9"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.8.9 Ensure GDM autorun-never is not overridden (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The autorun-never setting allows the GNOME Desktop Display Manager to disable autorun through GDM.

By using the lockdown mode in dconf, you can prevent users from changing specific settings.

To lock down a dconf key or subpath, create a locks subdirectory in the keyfile directory. The files inside this directory contain a list of keys or subpaths to lock. Just as with the keyfiles, you may add any number of files to this directory.

Example Lock File:

```
# Lock desktop media-handling settings
/org/gnome/desktop/media-handling/autorun-never
```

## Rationale

Malware on removable media may taking advantage of Autorun features when the media is inserted into a system and execute.

## Audit Procedure

### Command Line

Run the following script to verify that `autorun-never=true` cannot be overridden:

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
        # Look for idle-delay to determine profile in use, needed for remaining tests
        l_kfd="/etc/dconf/db/$(grep -Psril '^\h*autorun-never\b' /etc/dconf/db/*/ | awk -F'/' '{split($(NF-1),a,".");print a[1]}').d" #set directory of key file to be locked
        if [ -d "$l_kfd" ]; then # If key file directory doesn't exist, options can't be locked
            if grep -Prisq '^\h*\/org\/gnome\/desktop\/media-handling\/autorun-never\b' "$l_kfd"; then
                l_output="$l_output\n - \"autorun-never\" is locked in \"$(grep -Pril '^\h*\/org\/gnome\/desktop\/media-handling\/autorun-never\b' "$l_kfd")\""
            else
                l_output2="$l_output2\n - \"autorun-never\" is not locked"
            fi
        else
            l_output2="$l_output2\n - \"autorun-never\" is not set so it can not be locked"
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

## Remediation

### Command Line

Run the following script to ensure that `autorun-never=true` cannot be overridden:

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
        $l_pq "$l_pn" > /dev/null 2>&1 && l_pkgoutput="$l_pkgoutput\n - Package: \"$l_pn\" exists on the system\n - remediating configuration if needed"
    done
    # Check configuration (If applicable)
    if [ -n "$l_pkgoutput" ]; then
        # Look for autorun to determine profile in use, needed for remaining tests
        l_kfd="/etc/dconf/db/$(grep -Psril '^\h*autorun-never\b' /etc/dconf/db/*/ | awk -F'/' '{split($(NF-1),a,".");print a[1]}').d" #set directory of key file to be locked
        if [ -d "$l_kfd" ]; then # If key file directory doesn't exist, options can't be locked
            if grep -Priq '^\h*\/org\/gnome\/desktop\/media-handling\/autorun-never\b' "$l_kfd"; then
                echo " - \"autorun-never\" is locked in \"$(grep -Pril '^\h*\/org\/gnome\/desktop\/media-handling\/autorun-never\b' "$l_kfd")\""
            else
                echo " - creating entry to lock \"autorun-never\""
                { ! -d "$l_kfd"/locks } && echo "creating directory $l_kfd/locks" && mkdir "$l_kfd"/locks
                {
                    echo -e '\n# Lock desktop media-handling autorun-never setting'
                    echo '/org/gnome/desktop/media-handling/autorun-never'
                } >> "$l_kfd"/locks/00-media-autorun
            fi
        else
            echo -e " - \"autorun-never\" is not set so it can not be locked\n - Please follow Recommendation \"Ensure GDM autorun-never is enabled\" and follow this Recommendation again"
        fi
        # update dconf database
        dconf update
    else
        echo -e " - GNOME Desktop Manager package is not installed on the system\n  - Recommendation is not applicable"
    fi
}
```

## References

1. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 10.3 Disable Autorun and Autoplay for Removable Media | X    | X    | X    |
| v7               | 8.5 Configure Devices Not To Auto-run Content         | X    | X    | X    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics        | Mitigations |
| --------------------------- | -------------- | ----------- |
| T1091, T1091.000            | TA0001, TA0008 | M1028       |
