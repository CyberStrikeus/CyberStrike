---
name: cis-ubuntu2004-v300-1-1-1-7
description: "Ensure squashfs kernel module is not available"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, kernel-module]
cis_id: "1.1.1.7"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure squashfs kernel module is not available

## Profile

Level 2 - Server, Level 2 - Workstation, Assessment: Automated

## Description

The `squashfs` filesystem type is a compressed read-only Linux filesystem embedded in small footprint systems. A `squashfs` image can be used without having to first decompress the image.

## Rationale

Removing support for unneeded filesystem types reduces the local attack surface of the system. If this filesystem type is not needed, disable it.

## Impact

As Snap packages utilize `squashfs` as a compressed filesystem, disabling `squashfs` will cause Snap packages to fail.

Snap application packages of software are self-contained and work across a range of Linux distributions. This is unlike traditional Linux package management approaches, like APT or RPM, which require specifically adapted packages per Linux distribution on an application update and delay therefore application deployment from developers to their software's end-user. Snaps themselves have no dependency on any external store ("App store"), can be obtained from any source and can be therefore used for upstream software deployment.

Note: On operating systems where `squashfs` is pre-build into the kernel:

- This is considered an acceptable "passing" state
- The kernel should not be re-compiled to remove `squashfs`
- This audit will return a passing state with "module: "squashfs" doesn't exist in ..."

## Audit Procedure

### Command Line

Verify the `squashfs` kernel module is not available on the system - OR - has been disabled.

Run the following script to determine if the `squashfs` kernel module is available on the system:

```bash
#!/usr/bin/env bash

{
   l_mod_name="squashfs" l_mod_type="fs"
   while IFS= read -r l_mod_path; do
      if [ -d "$l_mod_path/${l_mod_name}/-/\/" ] &&  [ -n "$(ls -A "$l_mod_path/${l_mod_name}/-/\/")" ]; then
         printf '%s\n' "$l_mod_name exists in $l_mod_path"
      fi
   done < <(readlink -f /usr/lib/modules/**/kernel/$l_mod_type || readlink -f /lib/modules/**/kernel/$l_mod_type)
}
```

If nothing is returned, the `squashfs` kernel module is not available on the system and no further audit steps are required.

Note: Some systems may include the `squashfs` filesystem as part of the kernel opposed to being available as a kernel module. In this case, the above audit will not return anything. This is also considered a passing state.

If anything is returned, verify the `squashfs` kernel module is not loaded and not loadable by performing the following:

Run the following command to verify the `squashfs` kernel module is not loaded:

```bash
# lsmod | grep 'squashfs'
```

Nothing should be returned

Run the following command to verify the `squashfs` kernel module is not loadable:

```bash
# modprobe --showconfig | grep -P -- '\b(install|blacklist)\h+squashfs\b'
```

Verify the output includes:

```
blacklist squashfs
 -AND-
install squashfs /bin/false
 -OR-
install squashfs /bin/true
```

## Expected Result

```
blacklist squashfs
install squashfs /bin/false
```

## Remediation

### Command Line

Run the following commands to unload the `squashfs` kernel module:

```bash
# modprobe -r squashfs 2>/dev/null
# rmmod squashfs 2>/dev/null
```

Perform the following to disable the `squashfs` kernel module:

Create a file ending in `.conf` with `install squashfs /bin/false` in the `/etc/modprobe.d/` directory

Example:

```bash
# printf '\n%s\n' "install squashfs /bin/false" >> squashfs.conf
```

Create a file ending in `.conf` with `blacklist squashfs` in the `/etc/modprobe.d/` directory

Example:

```bash
# printf '\n%s\n' "blacklist squashfs" >> squashfs.conf
```

## Default Value

Not disabled by default.

## References

1. NIST SP 800-53 Rev. 5: CM-7

## CIS Controls

v8 - 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software (IG 2, IG 3)
v7 - 9.2 Ensure Only Approved Ports, Protocols and Services Are Running (IG 2, IG 3)

MITRE ATT&CK Mappings: T1005, T1005.000 | TA0005 | M1050
