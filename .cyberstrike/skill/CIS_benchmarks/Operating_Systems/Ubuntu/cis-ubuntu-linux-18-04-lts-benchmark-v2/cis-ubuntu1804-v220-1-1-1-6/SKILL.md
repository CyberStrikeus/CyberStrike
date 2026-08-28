---
name: cis-ubuntu1804-v220-1-1-1-6
description: "Ensure mounting of squashfs filesystems is disabled"
category: cis-storage
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, filesystem, squashfs, kernel-module]
cis_id: "1.1.1.6"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure mounting of squashfs filesystems is disabled

## Profile

Level 2 - Server / Level 2 - Workstation, Assessment: Automated

## Description

The squashfs filesystem type is a compressed read-only Linux filesystem embedded in small footprint systems. A squashfs image can be used without having to first decompress the image.

## Rationale

Removing support for unneeded filesystem types reduces the local attack surface of the system. If this filesystem type is not needed, disable it.

## Impact

As Snap packages utilizes squashfs as a compressed filesystem, disabling squashfs will cause Snap packages to fail.

Snap application packages of software are self-contained and work across a range of Linux distributions. This is unlike traditional Linux package management approaches, like APT or RPM, which require specifically adapted packages per Linux distribution on an application update and delay therefore application deployment from developers to their software's end-user. Snaps themselves have no dependency on any external store ("App store"), can be obtained from any source and can be therefore used for upstream software deployment.

## Audit Procedure

### Command Line

Run the following script to verify the squashfs module is disabled:

```bash
#!/usr/bin/env bash
{
    l_output="" l_output2="" l_output3="" l_dl=""
    l_mname="squashfs"
    l_mtype="fs"
    l_searchloc="/lib/modprobe.d/*.conf /usr/local/lib/modprobe.d/*.conf /run/modprobe.d/*.conf /etc/modprobe.d/*.conf"
    l_mpath="/lib/modules/**/kernel/$l_mtype"
    l_mpname="$(tr '-' ' ' <<< "$l_mname")"
    l_mndir="$(tr '-' '/' <<< "$l_mname")"
    module_loadable_chk()
    {
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
        if ! lsmod | grep "$l_mname" > /dev/null 2>&1; then
            l_output="$l_output\n - module: \"$l_mname\" is not loaded"
        else
            l_output2="$l_output2\n - module: \"$l_mname\" is loaded"
        fi
    }
    module_deny_chk()
    {
        l_dl="y"
        if modprobe --showconfig | grep -Pq -- '^\h*blacklist\h+'"$l_mpname"'\b'; then
            l_output="$l_output\n - module: \"$l_mname\" is deny listed in: \"$(grep -Pls -- "^\h*blacklist\h+$l_mname\b" $l_searchloc)\""
        else
            l_output2="$l_output2\n - module: \"$l_mname\" is not deny listed"
        fi
    }
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
    [ -n "$l_output3" ] && echo -e "\n\n -- INFO --\n - module: \"$l_mname\" exists in:$l_output3"
    if [ -z "$l_output2" ]; then
        echo -e "\n- Audit Result:\n  ** PASS **\n$l_output\n"
    else
        echo -e "\n- Audit Result:\n  ** FAIL **\n - Reason(s) for audit failure:\n$l_output2\n"
        [ -n "$l_output" ] && echo -e "\n- Correctly set:\n$l_output\n"
    fi
}
```

Note: On operating systems where squashfs is pre-build into the kernel:

- This is considered an acceptable "passing" state
- The kernel should not be re-compiled to remove squashfs
- This audit will return as passing state with "module: "squashfs" doesn't exist in ..."

## Expected Result

- module: "squashfs" is not loadable
- module: "squashfs" is not loaded
- module: "squashfs" is deny listed

## Remediation

### Command Line

If the module is available in the running kernel:

- Create a file with `install squashfs /bin/false` in the `/etc/modprobe.d/` directory
- Create a file with `blacklist squashfs` in the `/etc/modprobe.d/` directory
- Unload squashfs from the kernel

If available in ANY installed kernel:

- Create a file with `blacklist squashfs` in the `/etc/modprobe.d/` directory

If the kernel module is not available on the system or pre-compiled into the kernel:

- No remediation is necessary

## Default Value

Not disabled by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

v8 - 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software (IG 2, IG 3)
v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running (IG 2, IG 3)

MITRE ATT&CK Mappings: T1005, T1005.000 (TA0005) - M1050
