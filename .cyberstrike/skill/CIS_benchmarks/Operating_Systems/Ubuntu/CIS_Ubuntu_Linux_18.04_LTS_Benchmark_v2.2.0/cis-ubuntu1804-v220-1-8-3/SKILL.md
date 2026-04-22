---
name: cis-ubuntu1804-v220-1-8-3
description: "Ensure GDM disable-user-list option is enabled"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, gdm, gnome, disable-user-list, dconf]
cis_id: "1.8.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.8.3 Ensure GDM disable-user-list option is enabled (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

GDM is the GNOME Display Manager which handles graphical login for GNOME based systems.

The `disable-user-list` option controls if a list of users is displayed on the login screen.

## Rationale

Displaying the user list eliminates half of the Userid/Password equation that an unauthorized person would need to log on.

## Audit Procedure

### Command Line

Run the following script and to verify that the `disable-user-list` option is enabled or GNOME isn't installed:

```bash
#!/usr/bin/env bash

{
    l_pkgoutput=""
    if command -v dpkg-query > /dev/null 2>&1; then
        l_pq="dpkg-query -s"
    elif command -v rpm > /dev/null 2>&1; then
        l_pq="rpm -q"
    fi
    l_pcl="gdm gdm3" # Space separated list of packages to check
    for l_pn in $l_pcl; do
        $l_pq "$l_pn" > /dev/null 2>&1 && l_pkgoutput="$l_pkgoutput\n - Package: \"$l_pn\" exists on the system\n - checking configuration"
    done
    if [ -n "$l_pkgoutput" ]; then
        output="" output2=""
        l_gdmfile="$(grep -Pril '^\h*disable-user-list\h*=\h*true\b' /etc/dconf/db)"
        if [ -n "$l_gdmfile" ]; then
            output="$output\n - The \"disable-user-list\" option is enabled in \"$l_gdmfile\""
            l_gdmprofile="$(awk -F\/ '{split($(NF-1),a,".");print a[1]}' <<< "$l_gdmfile")"
            if grep -Pq "^\h*system-db:$l_gdmprofile" /etc/dconf/profile/"$l_gdmprofile"; then
                output="$output\n - The \"$l_gdmprofile\" exists"
            else
                output2="$output2\n - The \"$l_gdmprofile\" doesn't exist"
            fi
            if [ -f "/etc/dconf/db/$l_gdmprofile" ]; then
                output="$output\n - The \"$l_gdmprofile\" profile exists in the dconf database"
            else
                output2="$output2\n - The \"$l_gdmprofile\" profile doesn't exist in the dconf database"
            fi
        else
            output2="$output2\n - The \"disable-user-list\" option is not enabled"
        fi
        if [ -z "$output2" ]; then
            echo -e "$l_pkgoutput\n- Audit result:\n  *** PASS: ***\n$output\n"
        else
            echo -e "$l_pkgoutput\n- Audit Result:\n  *** FAIL: ***\n$output2\n"
            [ -n "$output" ] && echo -e "$output\n"
        fi
    else
        echo -e "\n\n - GNOME Desktop Manager isn't installed\n - Recommendation is Not Applicable\n- Audit results:\n  *** PASS ***\n"
    fi
}
```

## Remediation

### Command Line

Run the following script to enable the `disable-user-list` option:

Note: the `l_gdm_profile` variable in the script can be changed if a different profile name is desired in accordance with local site policy.

```bash
#!/usr/bin/env bash

{
    l_gdmprofile="gdm"
    if [ ! -f "/etc/dconf/profile/$l_gdmprofile" ]; then
        echo "Creating profile \"$l_gdmprofile\""
        echo -e "user-db:user\nsystem-db:$l_gdmprofile\nfile-db:/usr/share/$l_gdmprofile/greeter-dconf-defaults" > /etc/dconf/profile/$l_gdmprofile
    fi
    if [ ! -d "/etc/dconf/db/$l_gdmprofile.d/" ]; then
        echo "Creating dconf database directory \"/etc/dconf/db/$l_gdmprofile.d/\""
        mkdir /etc/dconf/db/$l_gdmprofile.d/
    fi
    if ! grep -Piq '^\h*disable-user-list\h*=\h*true\b' /etc/dconf/db/$l_gdmprofile.d/*; then
        echo "creating gdm keyfile for machine-wide settings"
        if ! grep -Piq -- '^\h*\[org\/gnome\/login-screen\]' /etc/dconf/db/$l_gdmprofile.d/*; then
            echo -e "\n[org/gnome/login-screen]\n# Do not show the user list\ndisable-user-list=true" >> /etc/dconf/db/$l_gdmprofile.d/00-login-screen
        else
            sed -ri '/^\s*\[org\/gnome\/login-screen\]/ a\# Do not show the user list\ndisable-user-list=true' $(grep -Pil -- '^\h*\[org\/gnome\/login-screen\]' /etc/dconf/db/$l_gdmprofile.d/*)
        fi
    fi
    dconf update
}
```

Note: When the user profile is created or changed, the user will need to log out and log in again before the changes will be applied.

OR

Run the following command to remove the GNOME package:

```bash
apt purge gdm3
```

## Default Value

false

## References

1. https://help.gnome.org/admin/system-admin-guide/stable/login-userlist-disable.html.en
2. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## Additional Information

If a different GUI login service is in use and required on the system, consult your documentation to disable displaying the user list.

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1078, T1078.001, T1078.002, T1078.003, T1087, T1087.001, T1087.002 | TA0007 | M1028 |
