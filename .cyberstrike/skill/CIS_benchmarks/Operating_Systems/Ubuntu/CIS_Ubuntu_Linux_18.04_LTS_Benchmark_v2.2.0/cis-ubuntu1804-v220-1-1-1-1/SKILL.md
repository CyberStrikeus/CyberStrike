---
name: cis-ubuntu1804-v220-1-1-1-1
description: "Ensure mounting of cramfs filesystems is disabled"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, filesystem, cramfs, kernel-module]
cis_id: "1.1.1.1"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure mounting of cramfs filesystems is disabled

## Profile

Level 1 - Server / Level 1 - Workstation, Assessment: Automated

## Description

The cramfs filesystem type is a compressed read-only Linux filesystem embedded in small footprint systems. A cramfs image can be used without having to first decompress the image.

## Rationale

Removing support for unneeded filesystem types reduces the local attack surface of the system. If this filesystem type is not needed, disable it.

## Impact

None noted.

## Audit Procedure

### Command Line

Run the following script to verify the cramfs module is disabled:

```bash
#!/usr/bin/env bash
{
    l_output="" l_output2="" l_output3="" l_dl="" # Unset output variables
    l_mname="cramfs" # set module name
    l_mtype="fs" # set module type
    l_searchloc="/lib/modprobe.d/*.conf /usr/local/lib/modprobe.d/*.conf /run/modprobe.d/*.conf /etc/modprobe.d/*.conf"
    l_mpath="/lib/modules/**/kernel/$l_mtype"
    l_mpname="$(tr '-' ' ' <<< "$l_mname")"
    l_mndir="$(tr '-' '/' <<< "$l_mname")"

    module_loadable_chk()
    {
        # Check if the module is currently loadable
        l_loadable="$(modprobe -n -v "$l_mname")"
        [ "$(wc -l <<< "$l_loadable")" -gt "1" ] && l_loadable="$(grep -P -- "(^\h*install|\b$l_mname)\b" <<< "$l_loadable")"
        if grep -Pq -- '^\h*install \/bin\/(true|false)' <<< "$l_loadable"; then
            l_output="$l_output\n - module: \"$l_mname\" is not loadable: \"$l_loadable\""
        else
            l_output2="$l_output2\n - module: \"$l_mname\" is loadable: \"$l_loadable\""
        fi
    }
    module_loaded_chk()
    {
        # Check if the module is currently loaded
        if ! lsmod | grep "$l_mname" > /dev/null 2>&1; then
            l_output="$l_output\n - module: \"$l_mname\" is not loaded"
        else
            l_output2="$l_output2\n - module: \"$l_mname\" is loaded"
        fi
    }
    module_deny_chk()
    {
        # Check if the module is deny listed
        l_dl="y"
        if modprobe --showconfig | grep -Pq -- '^\h*blacklist\h+'"$l_mpname"'\b'; then
            l_output="$l_output\n - module: \"$l_mname\" is deny listed in: \"$(grep -Pls -- "^\h*blacklist\h+$l_mname\b" $l_searchloc)\""
        else
            l_output2="$l_output2\n - module: \"$l_mname\" is not deny listed"
        fi
    }
    # Check if the module exists on the system
    for l_mdir in $l_mpath; do
        if [ -d "$l_mdir/$l_mndir" ] && [ -n "$(ls -A $l_mdir/$l_mndir)" ]; then
            l_output3="$l_output3\n  - \"$l_mdir\""
            [ "$l_dl" != "y" ] && module_deny_chk
            if [ "$l_mdir" = "/lib/modules/$(uname -r)/kernel/$l_mtype" ]; then
                module_loadable_chk
                module_loaded_chk
            fi
        else
            l_output="$l_output\n - module: \"$l_mname\" doesn't exist in \"$l_mdir\""
        fi
    done
    # Report results. If no failures output in l_output2, we pass
    [ -n "$l_output3" ] && echo -e "\n\n -- INFO --\n - module: \"$l_mname\" exists in:$l_output3"
    if [ -z "$l_output2" ]; then
        echo -e "\n- Audit Result:\n  ** PASS **\n$l_output\n"
    else
        echo -e "\n- Audit Result:\n  ** FAIL **\n - Reason(s) for audit failure:\n$l_output2\n"
        [ -n "$l_output" ] && echo -e "\n- Correctly set:\n$l_output\n"
    fi
}
```

## Expected Result

- module: "cramfs" is not loadable
- module: "cramfs" is not loaded
- module: "cramfs" is deny listed

## Remediation

### Command Line

Run the following script to disable the cramfs module:

```bash
#!/usr/bin/env bash
{
    l_mname="cramfs" # set module name
    l_mtype="fs" # set module type
    l_mpath="/lib/modules/**/kernel/$l_mtype"
    l_mpname="$(tr '-' ' ' <<< "$l_mname")"
    l_mndir="$(tr '-' '/' <<< "$l_mname")"

    module_loadable_fix()
    {
        # If the module is currently loadable, add "install {MODULE_NAME} /bin/false" to a file in "/etc/modprobe.d"
        l_loadable="$(modprobe -n -v "$l_mname")"
        [ "$(wc -l <<< "$l_loadable")" -gt "1" ] && l_loadable="$(grep -P -- "(^\h*install|\b$l_mname)\b" <<< "$l_loadable")"
        if ! grep -Pq -- '^\h*install \/bin\/(true|false)' <<< "$l_loadable"; then
            echo -e "\n - setting module: \"$l_mname\" to be not loadable"
            echo -e "install $l_mname /bin/false" >> /etc/modprobe.d/"$l_mpname".conf
        fi
    }
    module_loaded_fix()
    {
        # If the module is currently loaded, unload the module
        if lsmod | grep "$l_mname" > /dev/null 2>&1; then
            echo -e "\n - unloading module \"$l_mname\""
            modprobe -r "$l_mname"
        fi
    }
    module_deny_fix()
    {
        # If the module isn't deny listed, denylist the module
        if ! modprobe --showconfig | grep -Pq -- "^\h*blacklist\h+$l_mpname\b"; then
            echo -e "\n - deny listing \"$l_mname\""
            echo -e "blacklist $l_mname" >> /etc/modprobe.d/"$l_mpname".conf
        fi
    }
    # Check if the module exists on the system
    for l_mdir in $l_mpath; do
        if [ -d "$l_mdir/$l_mndir" ] && [ -n "$(ls -A $l_mdir/$l_mndir)" ]; then
            echo -e "\n - module: \"$l_mname\" exists in \"$l_mdir\"\n - checking if disabled..."
            module_deny_fix
            if [ "$l_mdir" = "/lib/modules/$(uname -r)/kernel/$l_mtype" ]; then
                module_loadable_fix
                module_loaded_fix
            fi
        else
            echo -e "\n - module: \"$l_mname\" doesn't exist in \"$l_mdir\"\n"
        fi
    done
    echo -e "\n - remediation of module: \"$l_mname\" complete\n"
}
```

## Default Value

Not disabled by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

v8 - 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software (IG 2, IG 3)
v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running (IG 2, IG 3)

MITRE ATT&CK Mappings: T1005, T1005.000 (TA0005) - M1050
